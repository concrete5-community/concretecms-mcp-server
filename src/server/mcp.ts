import { log } from '../log.js'
import {
  OpenAPIServer,
  AuthProvider,
  StreamableHttpServerTransport,
  OpenAPIMCPServerConfig,
} from '@ivotoby/openapi-mcp-server'
import { DebugName } from '../httpDebug.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Server } from 'node:http'
import {
  apiDebug,
  canonical_url,
  httpHost,
  httpPort,
  mcpEndpointPath,
  oauthStartPath,
  publicBaseUrl,
  transportType,
} from '../env.js'
import { OPENAPI_SPEC_FILE } from '../paths.js'
import { createPageTools } from '../tools/pageTools.js'
import { applyGeneratedToolAnnotations } from '../tools/annotations.js'
import { applyLibraryHttpDebug } from '../httpDebug.js'
import { fetchLiveOpenApiSpec } from '../cms/openApiSpec.js'

export interface McpServerOptions {
  transport?: 'stdio' | 'http'
  httpServer?: Server
}

export async function startMcpServer(
  authProvider: AuthProvider,
  options: McpServerOptions = {}
): Promise<void> {
  const transport = options.transport ?? transportType
  log(`Starting MCP server (${transport} transport)...`)

  // Prefer the spec served live by Concrete (reflects the actual installation),
  // falling back to the bundled openapi.yml when it is unavailable.
  const liveSpec = await fetchLiveOpenApiSpec()
  log(
    liveSpec
      ? 'Using the OpenAPI spec fetched live from Concrete'
      : 'Using the bundled OpenAPI spec (openapi.yml)'
  )

  const openApiServerConfig: OpenAPIMCPServerConfig = {
    name: 'Concrete CMS',
    version: '1.0.0',
    apiBaseUrl: canonical_url,
    // openApiSpec (the file path) is only used in 'file' mode; in 'inline' mode
    // the library reads inlineSpecContent and ignores it.
    openApiSpec: liveSpec ? '' : OPENAPI_SPEC_FILE,
    specInputMethod: liveSpec ? 'inline' : 'file',
    inlineSpecContent: liveSpec ?? undefined,
    transportType: transport,
    httpPort,
    httpHost,
    endpointPath: mcpEndpointPath,
    toolsMode: 'all',
    disableAbbreviation: true,
    authProvider,
    extraTools: createPageTools(authProvider),
  }

  const openApiServer = new OpenAPIServer(openApiServerConfig)

  if (transport === 'http') {
    if (!options.httpServer) {
      throw new Error('HTTP transport requires a shared HTTP server instance')
    }

    const httpTransport = new StreamableHttpServerTransport(
      httpPort,
      httpHost,
      mcpEndpointPath,
      options.httpServer,
      false
    )

    await openApiServer.start(httpTransport)
    applyGeneratedToolAnnotations(openApiServer)
    if (apiDebug) {
      applyLibraryHttpDebug(DebugName.ApiCall, openApiServer)
    }
    log(`Remote MCP server running at ${publicBaseUrl}${mcpEndpointPath}`)
    log(`OAuth start URL: ${publicBaseUrl}${oauthStartPath}`)
    return
  }

  const stdioTransport = new StdioServerTransport()
  await openApiServer.start(stdioTransport)
  applyGeneratedToolAnnotations(openApiServer)
  if (apiDebug) {
    applyLibraryHttpDebug(DebugName.ApiCall, openApiServer)
  }
}
