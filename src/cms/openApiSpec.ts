import * as client from 'openid-client'
import { config } from '../auth/oidc.js'
import { canonical_url } from '../env.js'
import { log } from '../log.js'
import { redactError } from '../utils/redact.js'

const OPENAPI_SCOPE = 'system:openapi:read'
const OPENAPI_ENDPOINT = '/ccm/api/1.0/system/openapi'
const FETCH_TIMEOUT_MS = 10_000
// Overall cap so a hung Concrete (accepts the connection but never responds)
// cannot block server startup; the token request is otherwise unbounded.
const OVERALL_TIMEOUT_MS = 15_000

async function requestLiveOpenApiSpec(): Promise<string | null> {
  try {
    const tokens = await client.clientCredentialsGrant(config, { scope: OPENAPI_SCOPE })

    const response = await fetch(`${canonical_url}${OPENAPI_ENDPOINT}`, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (!response.ok) {
      log(`Live OpenAPI spec request returned HTTP ${response.status}`)
      return null
    }

    return await response.text()
  } catch (error) {
    log(`Live OpenAPI spec request failed: ${redactError(error)}`)
    return null
  }
}

/**
 * Fetch the OpenAPI specification live from Concrete using a client-credentials
 * token (server-level, no user login required), so the exposed tools reflect the
 * actual installation. Returns the spec text, or null on any failure — a missing
 * `system:openapi:read` scope, an older Concrete without the endpoint, a network
 * timeout, etc. The caller then falls back to the bundled openapi.yml.
 */
export async function fetchLiveOpenApiSpec(): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      log(`Live OpenAPI spec request timed out after ${OVERALL_TIMEOUT_MS}ms`)
      resolve(null)
    }, OVERALL_TIMEOUT_MS)
  })

  try {
    return await Promise.race([requestLiveOpenApiSpec(), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const GUIDE_OPERATION_ID = 'getSystemGuide'
const GUIDE_TOOL = 'get-system-guide'

// MCP server instructions handed to the client. Kept short: sent every session.
const GUIDE_INSTRUCTIONS =
  `Call the \`${GUIDE_TOOL}\` tool to understand how this installation's data ` +
  `is structured and used; read it before writing. It can change over time, ` +
  `so refresh it occasionally rather than trusting a stale copy.`

function specDefinesOperation(spec: unknown, operationId: string): boolean {
  const paths = (spec as { paths?: Record<string, Record<string, { operationId?: string }>> })
    ?.paths
  if (!paths) return false
  for (const pathItem of Object.values(paths)) {
    for (const operation of Object.values(pathItem ?? {})) {
      if (operation && typeof operation === 'object' && operation.operationId === operationId) {
        return true
      }
    }
  }
  return false
}

/**
 * Server instructions for a fetched spec: when the installation serves its usage
 * guide, point agents at it. Returns undefined when the guide is not available.
 */
export function buildServerInstructions(specText: string): string | undefined {
  try {
    if (specDefinesOperation(JSON.parse(specText), GUIDE_OPERATION_ID)) {
      return GUIDE_INSTRUCTIONS
    }
  } catch {
    // Unparseable spec: no instructions.
  }
  return undefined
}
