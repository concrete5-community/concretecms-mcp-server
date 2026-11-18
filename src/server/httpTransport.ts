import { randomUUID } from 'node:crypto'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { StreamableHttpServerTransport } from '@ivotoby/openapi-mcp-server'
import type { JSONRPCMessage, RequestId } from '@modelcontextprotocol/sdk/types.js'

const MAX_BODY_SIZE = 4 * 1024 * 1024

type Session = {
  messageHandler: (message: JSONRPCMessage) => void
  activeResponses: Set<ServerResponse>
  initialized: boolean
  pendingRequests: Set<RequestId>
}

// The private members of the transport of the library that this transport relies on
type LibraryInternals = {
  sessions: Map<string, Session>
  handlePostRequest: (req: IncomingMessage, res: ServerResponse) => void
}

type WaitingRequest = {
  res: ServerResponse
  sessionId: string
  originalId: RequestId
  headers: Record<string, string>
}

type JsonObject = Record<string, unknown>

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRequestId(value: unknown): value is RequestId {
  return typeof value === 'string' || typeof value === 'number'
}

function sendError(
  res: ServerResponse,
  statusCode: number,
  code: number,
  message: string,
  id: unknown = null
): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(
    JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: isRequestId(id) ? id : null })
  )
}

/**
 * The transport of the library answers only `initialize` and `tools/list` in the response of their POST.
 * The other answers go to the GET stream of the session, which some clients never open
 * (for example the custom connectors of Claude): they would wait forever.
 *
 * This transport answers every request in the response of its own POST, as the MCP specification says.
 */
export class PostAnsweringHttpTransport extends StreamableHttpServerTransport {
  // The key is an ID of ours: the IDs chosen by the clients are not unique across the sessions
  private readonly waitingRequests = new Map<string, WaitingRequest>()

  constructor(port: number, host: string, endpointPath: string, server: Server) {
    super(port, host, endpointPath, server, false)

    const internals = this.libraryInternals()
    if (!(internals.sessions instanceof Map) || typeof internals.handlePostRequest !== 'function') {
      throw new Error(
        'The HTTP transport of @ivotoby/openapi-mcp-server changed: the connector cannot answer the requests anymore'
      )
    }
    internals.handlePostRequest = (req, res) => this.readMessage(req, res)
  }

  override send(message: JSONRPCMessage): Promise<void> {
    if ('method' in message) {
      // Notifications and requests of the server: the library sends them to the GET streams
      return super.send(message)
    }

    const key = 'id' in message ? String(message.id) : ''
    const waiting = this.waitingRequests.get(key)
    if (waiting) {
      this.waitingRequests.delete(key)
      waiting.res.writeHead(200, { 'Content-Type': 'application/json', ...waiting.headers })
      waiting.res.end(JSON.stringify({ ...message, id: waiting.originalId }))
    }
    // Otherwise the client is gone: the library would send the answer to all the sessions

    return Promise.resolve()
  }

  private libraryInternals(): LibraryInternals {
    return this as unknown as LibraryInternals
  }

  private readMessage(req: IncomingMessage, res: ServerResponse): void {
    if (res.writableEnded) {
      return
    }
    if (!req.headers['content-type']?.includes('application/json')) {
      sendError(res, 415, -32000, 'Unsupported Media Type: Content-Type must be application/json')
      return
    }

    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_SIZE) {
        sendError(res, 413, -32000, 'Request entity too large')
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (res.writableEnded) {
        return
      }
      let message: unknown
      try {
        message = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        sendError(res, 400, -32700, 'Parse error')
        return
      }
      this.handleMessage(message, req, res)
    })
    req.on('error', (error) => this.onerror?.(error))
  }

  private handleMessage(message: unknown, req: IncomingMessage, res: ServerResponse): void {
    if (!isJsonObject(message)) {
      sendError(res, 400, -32600, 'Invalid Request')
      return
    }
    const handler = this.onmessage
    if (!handler) {
      sendError(res, 500, -32603, 'Internal error: No message handler available', message.id)
      return
    }

    const sessions = this.libraryInternals().sessions
    const isRequest = typeof message.method === 'string' && isRequestId(message.id)
    const headers: Record<string, string> = {}
    let sessionId = req.headers['mcp-session-id']
    if (isRequest && message.method === 'initialize') {
      sessionId = randomUUID()
      sessions.set(sessionId, {
        messageHandler: handler,
        activeResponses: new Set(),
        initialized: true,
        pendingRequests: new Set(),
      })
      headers['Mcp-Session-Id'] = sessionId
    } else if (typeof sessionId !== 'string' || !sessions.has(sessionId)) {
      sendError(
        res,
        400,
        -32000,
        'Invalid session. A valid Mcp-Session-Id header is required.',
        message.id
      )
      return
    }

    if (!isRequest) {
      handler(this.withOurRequestId(message, sessionId) as JSONRPCMessage)
      res.writeHead(202)
      res.end()
      return
    }

    const ourId = randomUUID()
    this.waitingRequests.set(ourId, {
      res,
      sessionId,
      originalId: message.id as RequestId,
      headers,
    })
    res.on('close', () => this.waitingRequests.delete(ourId))
    handler({ ...message, id: ourId } as JSONRPCMessage)
  }

  /** A client cancels a request by the ID it chose: the server knows that request by our ID. */
  private withOurRequestId(message: JsonObject, sessionId: string): JsonObject {
    if (message.method !== 'notifications/cancelled' || !isJsonObject(message.params)) {
      return message
    }
    for (const [ourId, waiting] of this.waitingRequests) {
      if (waiting.sessionId === sessionId && waiting.originalId === message.params.requestId) {
        return { ...message, params: { ...message.params, requestId: ourId } }
      }
    }
    return message
  }
}
