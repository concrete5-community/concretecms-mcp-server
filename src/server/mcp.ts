import { log } from '../log.js'
import {
  OpenAPIServer,
  AuthProvider,
  StreamableHttpServerTransport,
  OpenAPIMCPServerConfig,
  ToolsManager,
  type ExtraToolDefinition,
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
  scope,
  transportType,
} from '../env.js'
import { OPENAPI_SPEC_FILE } from '../paths.js'
import { createPageTools, PAGE_TOOL_OPERATIONS } from '../tools/pageTools.js'
import { createConnectionTools } from '../tools/connectionTools.js'
import { createUnavailableToolsDefinition } from '../tools/unavailableTools.js'
import { applyGeneratedToolAnnotations } from '../tools/annotations.js'
import { applyLibraryHttpDebug } from '../httpDebug.js'
import { fetchLiveOpenApiSpec, buildServerInstructions, GUIDE_TOOL } from '../cms/openApiSpec.js'
import {
  missingScopes,
  parseScopes,
  selectGeneratedTools,
  type SelectedTools,
  type SpecLike,
  type UnavailableTool,
} from '../tools/scopeFilter.js'
import { redactError } from '../utils/redact.js'

export interface McpServerOptions {
  transport?: 'stdio' | 'http'
  httpServer?: Server
}

/** Split the generated tools by what the configured scopes allow, or null to expose them all. */
async function selectAllowedTools(
  config: OpenAPIMCPServerConfig,
  granted: string[]
): Promise<SelectedTools | null> {
  try {
    // A first pass over the spec, only to learn which scopes every tool needs.
    const probe = new ToolsManager({ ...config, toolsMode: 'all', verbose: false })
    await probe.initialize()
    return selectGeneratedTools(
      probe.getToolsWithIds(),
      probe.getOpenApiSpec() as unknown as SpecLike | undefined,
      granted
    )
  } catch (error) {
    log(`Could not filter the tools by scope, exposing them all: ${redactError(error)}`)
    return null
  }
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
  }

  const granted = parseScopes(scope || 'account:read')
  const allowed = await selectAllowedTools(openApiServerConfig, granted)
  // Null when the scopes could not be checked: every tool is exposed.
  const unavailable: UnavailableTool[] | null = allowed ? [...allowed.unavailable] : null
  if (allowed) {
    // In 'all' mode an empty list would mean "no filter".
    openApiServerConfig.toolsMode = 'explicit'
    openApiServerConfig.includeTools = allowed.ids
  }

  // When the live spec exposes the usage guide, point agents at it (if they can read it).
  if (liveSpec && (!allowed || allowed.names.includes(GUIDE_TOOL))) {
    openApiServerConfig.instructions = buildServerInstructions(liveSpec)
  }

  const extraTools: ExtraToolDefinition[] = []
  for (const definition of createPageTools(authProvider)) {
    const missing = allowed
      ? missingScopes(PAGE_TOOL_OPERATIONS[definition.id] ?? [], allowed.operationScopes, granted)
      : []
    if (!unavailable || missing.length === 0) {
      extraTools.push(definition)
      continue
    }
    unavailable.push({
      name: definition.tool.name,
      description: definition.tool.description ?? '',
      scopes: missing,
      needs: 'all',
    })
  }
  if (unavailable && unavailable.length > 0) {
    log(`Hiding ${unavailable.length} tools that the configured scopes do not allow to use`)
  }
  openApiServerConfig.extraTools = [
    ...extraTools,
    ...createConnectionTools(),
    createUnavailableToolsDefinition(unavailable),
  ]

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
