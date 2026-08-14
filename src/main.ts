import { log } from './log.js'
import { MultiUserAuthProvider } from './auth/MultiUserAuthProvider.js'
import { oauthStartPath, oauthDebug, transportType, warnStdioEncryptionOnce } from './env.js'
import { startMcpServer } from './server/mcp.js'
import { createSharedHttpServer } from './server/http.js'
import { cleanupExpiredTokens, migrateLegacyTokens } from './tokenStore.js'
import { cleanupStaleOAuthLocks } from './auth/oauthLock.js'

async function startStdioServer(authProvider: MultiUserAuthProvider): Promise<void> {
  warnStdioEncryptionOnce()
  migrateLegacyTokens()
  cleanupStaleOAuthLocks()
  cleanupExpiredTokens()

  log('OAuth will run on first tool call if tokens are missing or expired')
  await startMcpServer(authProvider, { transport: 'stdio' })
}

async function startHttpServer(authProvider: MultiUserAuthProvider): Promise<void> {
  migrateLegacyTokens()
  cleanupStaleOAuthLocks()
  cleanupExpiredTokens()

  const httpServer = createSharedHttpServer(authProvider)
  await startMcpServer(authProvider, { transport: 'http', httpServer })

  log(`Remote MCP server ready. Authorize users via ${oauthStartPath}`)
  if (oauthDebug) {
    log('OAUTH_DEBUG=1 — callback failures will include reason details in the browser')
  }
}

export async function main(): Promise<void> {
  const authProvider = new MultiUserAuthProvider()

  if (transportType === 'http') {
    await startHttpServer(authProvider)
    return
  }

  await startStdioServer(authProvider)
}
