import { log } from './log.js'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue
}

function optionalIntEnv(name: string, defaultValue: number): number {
  const value = process.env[name]
  if (!value) {
    return defaultValue
  }

  const parsed = parseInt(value, 10)
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer for environment variable ${name}: ${value}`)
  }

  return parsed
}

function optionalBoolEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]
  if (value === '1' || value === 'true') {
    return true
  }
  if (value === '0' || value === 'false') {
    return false
  }
  return defaultValue
}

export function normalizePathPrefix(prefix: string): string {
  if (!prefix || prefix === '/') {
    return ''
  }

  const normalized = prefix.startsWith('/') ? prefix : `/${prefix}`
  return normalized.replace(/\/$/, '')
}

function prefixedPath(segment: string, envName: string, pathPrefix: string): string {
  const defaultPath = pathPrefix ? `${pathPrefix}${segment}` : segment
  return optionalEnv(envName, defaultPath)
}

export const canonical_url = requireEnv('CONCRETE_CANONICAL_URL').replace(/\/+$/, '')
export const client_id = requireEnv('CONCRETE_API_CLIENT_ID')
export const client_secret = requireEnv('CONCRETE_API_CLIENT_SECRET')

// This server is a plain OAuth2 API client and never consumes the OIDC ID token.
// Requesting the `openid` scope makes Concrete issue an ID token whose claims do
// not satisfy openid-client's strict validation (e.g. `aud` is an internal UUID
// rather than the client_id), which aborts the whole authorization code exchange.
// Drop it — only the Concrete API scopes actually grant access to the REST API.
function sanitizeScope(rawScope: string): string {
  const requested = rawScope.split(/\s+/).filter(Boolean)
  const kept = requested.filter((s) => s.toLowerCase() !== 'openid')
  if (kept.length !== requested.length) {
    log(
      'Ignoring the "openid" scope: this server does not use OIDC ID tokens, and Concrete\'s ID token fails standard validation.'
    )
  }
  return kept.join(' ')
}

export const scope = sanitizeScope(requireEnv('CONCRETE_API_SCOPE'))

export type TransportType = 'stdio' | 'http'

const transportTypeValue = optionalEnv('TRANSPORT_TYPE', 'stdio')
if (transportTypeValue !== 'stdio' && transportTypeValue !== 'http') {
  throw new Error(`Invalid TRANSPORT_TYPE: ${transportTypeValue}. Must be 'stdio' or 'http'.`)
}

export const transportType = transportTypeValue as TransportType
export const httpHost = optionalEnv('HTTP_HOST', transportType === 'http' ? '0.0.0.0' : '127.0.0.1')
export const httpPort = optionalIntEnv('HTTP_PORT', 3000)
export const pathPrefix = normalizePathPrefix(optionalEnv('PATH_PREFIX', ''))
export const mcpEndpointPath = prefixedPath('/mcp', 'MCP_ENDPOINT_PATH', pathPrefix)
export const oauthCallbackPath = prefixedPath('/oauth/callback', 'OAUTH_CALLBACK_PATH', pathPrefix)
export const oauthStartPath = prefixedPath('/oauth/start', 'OAUTH_START_PATH', pathPrefix)
export const oauthStatusPath = prefixedPath('/oauth/status', 'OAUTH_STATUS_PATH', pathPrefix)
export const oauthRevokePath = prefixedPath('/oauth/revoke', 'OAUTH_REVOKE_PATH', pathPrefix)
export const healthPath = prefixedPath('/health', 'HEALTH_PATH', pathPrefix)

export const stdioUserKey = optionalEnv('CONCRETE_USER_ID', 'local')

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, '')
}

export const publicBaseUrl = (() => {
  const url = process.env.PUBLIC_BASE_URL

  if (transportType === 'http') {
    if (!url) {
      throw new Error(
        'Missing required environment variable: PUBLIC_BASE_URL (required when TRANSPORT_TYPE=http)'
      )
    }
    return normalizeBaseUrl(url)
  }

  return normalizeBaseUrl(url || `http://localhost:${httpPort}`)
})()

export const oauthRedirectUri = `${publicBaseUrl}${oauthCallbackPath}`

export type McpApiKeyEntry = {
  key: string
  boundUserId: number | null
}

function parseMcpApiKeys(): McpApiKeyEntry[] {
  const keysJson = process.env.MCP_API_KEYS
  if (keysJson) {
    let parsed: Record<string, number | null>
    try {
      parsed = JSON.parse(keysJson) as Record<string, number | null>
    } catch {
      throw new Error(
        'Invalid MCP_API_KEYS: must be valid JSON object mapping keys to user IDs or null'
      )
    }

    return Object.entries(parsed).map(([key, boundUserId]) => ({
      key,
      boundUserId: boundUserId === null ? null : boundUserId,
    }))
  }

  const singleKey = process.env.MCP_API_KEY
  if (singleKey) {
    return [{ key: singleKey, boundUserId: null }]
  }

  return []
}

export const mcpApiKeys = parseMcpApiKeys()

export const tokenEncryptionKey = process.env.TOKEN_ENCRYPTION_KEY || null

export const oauthDebug = optionalBoolEnv('OAUTH_DEBUG', false)

// Log every Concrete REST request/response (method, URL, bodies, status) to
// stderr for troubleshooting. Sensitive fields are redacted, bodies truncated,
// and the bearer token is never logged. Off by default; noisy when on.
export const apiDebug = optionalBoolEnv('CONCRETE_API_DEBUG', false)

// Max length (characters) for any logged request/response body, shared across
// all debug output. 0 disables truncation (log the full body).
export const debugMaxBody = optionalIntEnv('DEBUG_MAX_BODY', 2000)

// Allow the Concrete server to be reached over plain HTTP. openid-client v6
// rejects non-HTTPS requests with OAUTH_HTTP_REQUEST_FORBIDDEN before OAuth
// discovery even starts, so this must be opt-in for local/dev instances served
// over HTTP. Never enable it against a production server.
export const allowInsecureHttp = optionalBoolEnv('CONCRETE_ALLOW_INSECURE_HTTP', false)

let stdioEncryptionWarningShown = false

export function getTokenEncryptionKey(): string | null {
  return tokenEncryptionKey
}

export function validateHttpSecrets(): void {
  if (transportType !== 'http') {
    return
  }

  if (!tokenEncryptionKey) {
    throw new Error(
      'Missing required environment variable: TOKEN_ENCRYPTION_KEY (required when TRANSPORT_TYPE=http)'
    )
  }

  if (mcpApiKeys.length === 0) {
    throw new Error(
      'Missing required environment variable: MCP_API_KEY or MCP_API_KEYS (required when TRANSPORT_TYPE=http)'
    )
  }
}

export function warnStdioEncryptionOnce(): void {
  if (transportType !== 'stdio' || tokenEncryptionKey || stdioEncryptionWarningShown) {
    return
  }

  stdioEncryptionWarningShown = true
  log(
    'Warning: TOKEN_ENCRYPTION_KEY is not set. Tokens will be stored in plaintext. Set TOKEN_ENCRYPTION_KEY to encrypt tokens at rest.'
  )
}

validateHttpSecrets()
