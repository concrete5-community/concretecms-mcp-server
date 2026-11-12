import type { ExtraToolDefinition } from '@ivotoby/openapi-mcp-server'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  allowInsecureHttp,
  canonical_url,
  client_id,
  oauthRedirectUri,
  scope,
  stdioRedirectUri,
  transportType,
} from '../env.js'
import { checkConnection, formatReport, type ConnectionCheckConfig } from './connectionCheck.js'

async function handleCheckConnection(): Promise<CallToolResult> {
  const remote = transportType === 'http'
  const config: ConnectionCheckConfig = {
    siteUrl: canonical_url,
    clientId: client_id,
    redirectUri: remote ? oauthRedirectUri : stdioRedirectUri,
    scope: scope || 'account:read',
    remote,
    allowInsecureHttp,
  }

  return {
    content: [{ type: 'text', text: formatReport(config, await checkConnection(config)) }],
  }
}

export function createConnectionTools(): ExtraToolDefinition[] {
  return [
    {
      id: 'check_connection',
      tool: {
        name: 'check_connection',
        description:
          'Check that this connector can work with the Concrete CMS site: site reachable, pretty URLs, API enabled, Authorization header, and the Client ID, Redirect URI and scopes of the API integration. It needs no sign-in. Use it when the user asks to check or troubleshoot the connection, or when the other tools fail with connection or authorization errors. Every failed check comes with how to fix it.',
        annotations: {
          title: 'Check connection',
          readOnlyHint: true,
        },
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: () => handleCheckConnection(),
    },
  ]
}
