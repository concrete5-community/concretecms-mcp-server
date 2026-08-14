import type { AuthProvider } from '@ivotoby/openapi-mcp-server'
import { canonical_url, apiDebug, debugMaxBody } from '../env.js'
import { log } from '../log.js'

const SENSITIVE_KEY = /password|passphrase|secret|token|authorization|credential/i

/** Recursively replace values of sensitive-looking keys with a placeholder. */
function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitive)
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? '<redacted>' : redactSensitive(val)
    }
    return out
  }
  return value
}

function truncate(text: string): string {
  if (debugMaxBody <= 0 || text.length <= debugMaxBody) {
    return text
  }
  return `${text.slice(0, debugMaxBody)}… (${text.length} characters total)`
}

/** Redact known-sensitive fields of a JSON body for logging; fall back to raw text. Always truncated. */
function formatBodyForLog(raw: string): string {
  try {
    return truncate(JSON.stringify(redactSensitive(JSON.parse(raw))))
  } catch {
    return truncate(raw)
  }
}

export class CmsApiError extends Error {
  readonly status: number
  readonly body: string

  constructor(status: number, body: string, method: string, path: string) {
    super(`CMS API ${method} ${path} failed (${status}): ${body}`)
    this.name = 'CmsApiError'
    this.status = status
    this.body = body
  }
}

export class CmsApiClient {
  constructor(private readonly authProvider: AuthProvider) {}

  async get<T = unknown>(path: string, query?: Record<string, string | undefined>): Promise<T> {
    const url = this.buildUrl(path, query)
    return this.request<T>('GET', url)
  }

  async put<T = unknown>(path: string, body: unknown = {}): Promise<T> {
    const url = this.buildUrl(path)
    return this.request<T>('PUT', url, body)
  }

  private buildUrl(path: string, query?: Record<string, string | undefined>): URL {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    const url = new URL(`${canonical_url}${normalizedPath}`)

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, value)
        }
      }
    }

    return url
  }

  private async request<T>(method: string, url: URL, body?: unknown): Promise<T> {
    const authHeaders = await this.authProvider.getAuthHeaders()
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...authHeaders,
    }

    const init: RequestInit = { method, headers }
    if (body !== undefined && method !== 'GET') {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }

    if (apiDebug) {
      log(`HTTP request: ${method} ${url.toString()}`)
      if (init.body !== undefined) {
        log(`HTTP request body: ${truncate(JSON.stringify(redactSensitive(body)))}`)
      }
    }

    const startedAt = Date.now()
    const response = await fetch(url, init)
    const text = await response.text()

    if (apiDebug) {
      log(
        `HTTP response: ${method} ${url.pathname} ${response.status} (${Date.now() - startedAt}ms)`
      )
      if (text) {
        log(`HTTP response body: ${formatBodyForLog(text)}`)
      }
    }

    if (!response.ok) {
      throw new CmsApiError(response.status, text.slice(0, 2000), method, url.pathname)
    }

    if (!text) {
      return undefined as T
    }

    try {
      return JSON.parse(text) as T
    } catch {
      throw new Error(`CMS API ${method} ${url.pathname} returned non-JSON response`)
    }
  }
}
