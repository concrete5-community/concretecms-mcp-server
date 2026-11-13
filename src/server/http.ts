import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { attachOAuthHandlers } from '../auth/oauthHandlers.js'
import { MultiUserAuthProvider } from '../auth/MultiUserAuthProvider.js'
import {
  adminPath,
  healthPath,
  oauthRevokePath,
  oauthStartPath,
  oauthStatusPath,
  publicBaseUrl,
} from '../env.js'
import { ADMIN_PAGE_FILE } from '../paths.js'
import { renderAdminPage } from './adminPage.js'
import { attachAuthMiddleware } from './authMiddleware.js'
import { blockFurtherResponseWrites } from './httpResponse.js'

function attachAdminPage(server: Server): void {
  const page = renderAdminPage(readFileSync(ADMIN_PAGE_FILE, 'utf8'), {
    start: oauthStartPath,
    status: oauthStatusPath,
    revoke: oauthRevokePath,
    health: healthPath,
  })

  server.on('request', (req, res) => {
    if (!req.url || res.writableEnded || req.method !== 'GET') {
      return
    }

    if (new URL(req.url, publicBaseUrl).pathname !== adminPath) {
      return
    }

    res.writeHead(200, page.headers)
    res.end(page.body)
    blockFurtherResponseWrites(res)
  })
}

export function createSharedHttpServer(authProvider: MultiUserAuthProvider): Server {
  const server = createServer()
  attachAuthMiddleware(server)
  attachOAuthHandlers(server, authProvider)
  if (adminPath) {
    attachAdminPage(server)
  }
  return server
}
