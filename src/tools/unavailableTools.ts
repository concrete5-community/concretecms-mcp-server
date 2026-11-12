import type { ExtraToolDefinition } from '@ivotoby/openapi-mcp-server'
import { formatUnavailableTools, type UnavailableTool } from './scopeFilter.js'

/**
 * The tool that tells what is hidden, and why.
 * `unavailable` is null when the scopes of the tools could not be checked.
 */
export function createUnavailableToolsDefinition(
  unavailable: UnavailableTool[] | null
): ExtraToolDefinition {
  return {
    id: 'list_unavailable_tools',
    tool: {
      name: 'list_unavailable_tools',
      description:
        'List the tools of this connector that are hidden because its scopes do not allow to use them, with the scopes they need (or tell that no tool is hidden). Use it when no available tool can do what the user asks, to tell which scope would make it possible.',
      annotations: {
        title: 'List unavailable tools',
        readOnlyHint: true,
      },
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    handler: () => ({
      content: [{ type: 'text', text: formatUnavailableTools(unavailable) }],
    }),
  }
}
