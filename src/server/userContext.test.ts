import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { PostAnsweringHttpTransport } from './httpTransport.js'
import { getCurrentUserId, runAsRequestUser, setRequestUserId } from './userContext.js'

type Json = Record<string, any>

let server: Server
let endpoint: string

before(async () => {
  server = createServer()
  // Like the middleware that checks the key: it runs before the body of the request is read
  server.prependListener('request', (req) => {
    const user = req.headers['x-user']
    if (typeof user === 'string') {
      setRequestUserId(req, user)
    }
  })
  const transport = new PostAnsweringHttpTransport(0, '127.0.0.1', '/mcp', server, runAsRequestUser)
  // Like a tool: it needs the user some time after the request arrived
  transport.onmessage = (message) => {
    const { id, params } = message as Json
    if (id === undefined) {
      return
    }
    setTimeout(() => {
      void Promise.resolve().then(() =>
        transport.send({
          jsonrpc: '2.0',
          id,
          result: { user: getCurrentUserId() ?? null },
        } as JSONRPCMessage)
      )
    }, params?.delay ?? 0)
  }
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`
})

after(() => {
  server.closeAllConnections()
  server.close()
})

async function call(user: string | undefined, delay = 0): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (user) {
    headers['X-User'] = user
  }
  const init = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} }),
  })
  await init.text()
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { ...headers, 'Mcp-Session-Id': init.headers.get('mcp-session-id') ?? '' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { delay } }),
  })
  return ((await response.json()) as Json).result.user
}

test('a request is handled as its user, after its body has been read', async () => {
  assert.equal(await call('42'), '42')
})

test('requests handled at the same time keep their own users', async () => {
  assert.deepEqual(await Promise.all([call('first', 60), call('second'), call('third', 30)]), [
    'first',
    'second',
    'third',
  ])
})

test('a request without a user is handled without one', async () => {
  assert.equal(await call(undefined), null)
})

test('outside a request there is no user', () => {
  assert.equal(getCurrentUserId(), undefined)
})
