// Central stderr logger for the MCP server.
//
// In stdio transport, stdout is reserved for the MCP JSON-RPC stream, so every
// diagnostic must go to stderr (the MCP host — e.g. Claude Desktop — captures
// it there). Routing all messages through here keeps the "[concretecms-mcp]"
// prefix in one place instead of repeating it at every call site.

const PREFIX = '[concretecms-mcp]'

export function log(message: string, ...args: unknown[]): void {
  console.error(`${PREFIX} ${message}`, ...args)
}
