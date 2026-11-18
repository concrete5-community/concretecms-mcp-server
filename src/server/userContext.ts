import { AsyncLocalStorage } from 'node:async_hooks'
import type { IncomingMessage } from 'node:http'

const userContext = new AsyncLocalStorage<string>()
const requestUsers = new WeakMap<IncomingMessage, string>()

export function setRequestUserId(req: IncomingMessage, userId: string): void {
  requestUsers.set(req, userId)
}

/**
 * Run the code that handles a request as the user of that request.
 *
 * The user is kept with the request: since Node.js 24, a context entered when a request arrives
 * is lost by the time its body has been read.
 */
export function runAsRequestUser<T>(req: IncomingMessage, fn: () => T): T {
  const userId = requestUsers.get(req)
  return userId === undefined ? fn() : userContext.run(userId, fn)
}

export function getCurrentUserId(): string | undefined {
  return userContext.getStore()
}

export function runWithUserId<T>(userId: string, fn: () => T): T {
  return userContext.run(userId, fn)
}
