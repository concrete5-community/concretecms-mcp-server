import { log } from '../log.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

export type ToolAnnotations = NonNullable<Tool['annotations']>

/**
 * Map an HTTP method to MCP safety hints.
 *
 * Read verbs are read-only; every write verb is flagged destructive, matching
 * the Claude extensions directory requirement that any tool which writes,
 * creates, deletes or sends carries `destructiveHint`.
 *
 * `idempotentHint` is deliberately NOT derived from the method: although HTTP
 * defines PUT and DELETE as idempotent, that is a contract the API may not
 * honor (e.g. PUT on a Concrete page creates a new page version on every call,
 * so it is not idempotent in practice). Overstating idempotency is unsafe — a
 * client could auto-retry and duplicate side effects — so we leave it unset
 * (the conservative default) rather than guess per operation.
 */
export function annotationsForMethod(method: string): ToolAnnotations {
  const verb = method.toUpperCase()

  if (verb === 'GET' || verb === 'HEAD') {
    return { readOnlyHint: true }
  }

  return {
    readOnlyHint: false,
    destructiveHint: true,
  }
}

interface OperationLike {
  operationId?: string
  summary?: string
}

interface ToolsManagerLike {
  getToolsWithIds(): Array<[string, Tool]>
  parseToolId(toolId: string): { method: string; path: string }
  getOpenApiSpec(): { paths?: Record<string, Record<string, OperationLike>> } | undefined
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']
const MAX_SUMMARY_TITLE_LENGTH = 60

/** Lowercase and strip separators so `get-block-by-id` matches `getBlockById`. */
function normalizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Turn a tool name into a human title, e.g. `delete-page-by-id` -> `Delete page by ID`. */
function humanizeName(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').trim().split(/\s+/)
  return words
    .map((word, index) => {
      if (word.toLowerCase() === 'id') return 'ID'
      return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word
    })
    .join(' ')
}

/** Build a map of normalized operationId -> short human title taken from the spec summary. */
function buildTitleMap(spec: ReturnType<ToolsManagerLike['getOpenApiSpec']>): Map<string, string> {
  const titles = new Map<string, string>()
  const paths = spec?.paths ?? {}

  for (const pathItem of Object.values(paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem?.[method]
      if (!operation?.operationId || !operation.summary) continue

      const title = operation.summary.trim().replace(/\.$/, '')
      if (title && title.length <= MAX_SUMMARY_TITLE_LENGTH) {
        titles.set(normalizeId(operation.operationId), title)
      }
    }
  }

  return titles
}

/**
 * The OpenAPI-generated tools are produced by @ivotoby/openapi-mcp-server and do
 * not carry MCP annotations. Once the server has initialized them, tag each with
 * safety hints derived from its HTTP method (encoded as `METHOD::path` in the
 * tool id). The generated tool objects are held by reference and served fresh on
 * every tools/list, so mutating them here is enough.
 *
 * This reaches into a private field, so it is written defensively: if the
 * library internals change shape, annotation is skipped (with a warning) rather
 * than crashing the server.
 */
export function applyGeneratedToolAnnotations(server: unknown): number {
  const toolsManager = (server as { toolsManager?: ToolsManagerLike })?.toolsManager

  if (
    !toolsManager ||
    typeof toolsManager.getToolsWithIds !== 'function' ||
    typeof toolsManager.parseToolId !== 'function'
  ) {
    log('Could not annotate generated tools: unexpected library internals')
    return 0
  }

  const titleMap = buildTitleMap(toolsManager.getOpenApiSpec())

  let annotated = 0
  for (const [toolId, tool] of toolsManager.getToolsWithIds()) {
    const { method } = toolsManager.parseToolId(toolId)
    const title = titleMap.get(normalizeId(tool.name)) ?? humanizeName(tool.name)
    tool.annotations = {
      title,
      ...tool.annotations,
      ...annotationsForMethod(method),
    }
    annotated++
  }

  return annotated
}
