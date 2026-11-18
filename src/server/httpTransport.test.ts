import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { PostAnsweringHttpTransport } from './httpTransport.js'

type Json = Record<string, any>

let server: Server
let transport: PostAnsweringHttpTransport
let endpoint: string
const received: Json[] = []

// A server that answers every request with its params, after the delay they ask for
function answer(message: Json): void {
  received.push(message)
  if (message.id === undefined) {
    return
  }
  setTimeout(() => {
    void transport.send({
      jsonrpc: '2.0',
      id: message.id,
      result: { echo: message.params ?? null },
    } as JSONRPCMessage)
  }, message.params?.delay ?? 0)
}

before(async () => {
  server = createServer()
  transport = new PostAnsweringHttpTransport(0, '127.0.0.1', '/mcp', server)
  transport.onmessage = (message) => answer(message as Json)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`
})

after(() => {
  server.closeAllConnections()
  server.close()
})

function post(message: Json, sessionId?: string): Promise<Response> {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify(message),
  })
}

async function openSession(): Promise<string> {
  const response = await post({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} })
  const sessionId = response.headers.get('mcp-session-id')
  assert.ok(sessionId, 'initialize gives a session ID')
  await response.json()
  return sessionId
}

test('initialize is answered in its POST, with the session ID', async () => {
  const response = await post({ jsonrpc: '2.0', id: 'first', method: 'initialize', params: {} })

  assert.equal(response.status, 200)
  assert.ok(response.headers.get('mcp-session-id'))
  assert.equal(((await response.json()) as Json).id, 'first')
})

test('a tool call is answered in its POST, without a GET stream', async () => {
  const sessionId = await openSession()

  const response = await post(
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'something' } },
    sessionId
  )

  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /application\/json/)
  assert.deepEqual(await response.json(), {
    jsonrpc: '2.0',
    id: 7,
    result: { echo: { name: 'something' } },
  })
})

test('two sessions using the same request ID get their own answers', async () => {
  const [first, second] = await Promise.all([openSession(), openSession()])

  // The answer of the first session comes after the one of the second session
  const [firstAnswer, secondAnswer] = await Promise.all([
    post(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { who: 'first', delay: 60 } },
      first
    ),
    post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { who: 'second' } }, second),
  ])

  assert.equal(((await firstAnswer.json()) as Json).result.echo.who, 'first')
  assert.equal(((await secondAnswer.json()) as Json).result.echo.who, 'second')
})

test('a notification is accepted without an answer', async () => {
  const sessionId = await openSession()

  const response = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId)

  assert.equal(response.status, 202)
  assert.equal(await response.text(), '')
})

test('a request of an unknown session is refused', async () => {
  const response = await post({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, 'unknown')

  assert.equal(response.status, 400)
  assert.equal(((await response.json()) as Json).id, 3)
})

test('a cancellation names the request as the server knows it', async () => {
  const sessionId = await openSession()
  const pending = post(
    { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { delay: 80 } },
    sessionId
  )
  await new Promise((resolve) => setTimeout(resolve, 20))

  await post(
    { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 9 } },
    sessionId
  )

  const latest = [...received].reverse()
  const cancelled = latest.find((message) => message.method === 'notifications/cancelled')
  const call = latest.find((message) => message.method === 'tools/call')
  assert.ok(cancelled && call)
  assert.notEqual(call.id, 9)
  assert.equal(cancelled.params.requestId, call.id)
  await (await pending).json()
})

test('an answer nobody waits for is not sent to the other sessions', async () => {
  const sessionId = await openSession()
  const abort = new AbortController()
  // The stream answers only when the server writes something to it
  const stream = fetch(endpoint, { headers: { 'Mcp-Session-Id': sessionId }, signal: abort.signal })
    .then(() => 'written')
    .catch(() => 'aborted')
  await new Promise((resolve) => setTimeout(resolve, 50))

  await transport.send({ jsonrpc: '2.0', id: 'nobody', result: { secret: true } } as JSONRPCMessage)

  const outcome = await Promise.race([
    stream,
    new Promise<string>((resolve) => setTimeout(() => resolve('silent'), 100)),
  ])
  assert.equal(outcome, 'silent')
  abort.abort()
  await stream
})
