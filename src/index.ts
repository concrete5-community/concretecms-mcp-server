// When launched from an MCPB bundle (e.g. Claude Desktop), optional user_config
// fields left blank are not substituted: the runtime leaves the literal
// "${user_config.KEY}" string in the environment instead of omitting the
// variable. Because that string is truthy, it slips past the code that falls
// back to defaults. Strip those values so blank optional settings behave as if
// unset. This must run before any module that reads process.env at load time is
// imported — hence the dynamic imports below (the logger included, so any future
// env-based logging configuration is only read after this has run).
const UNRESOLVED_PLACEHOLDER = /^\$\{user_config\.[^}]*\}$/
for (const [key, value] of Object.entries(process.env)) {
  if (typeof value === 'string' && UNRESOLVED_PLACEHOLDER.test(value.trim())) {
    delete process.env[key]
  }
}

const { log } = await import('./log.js')
const { main } = await import('./main.js')

main().catch((error) => {
  log('Error in MCP server:', error)
  process.exit(1)
})

export {}
