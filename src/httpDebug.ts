import { apiDebug, debugMaxBody } from './env.js'
import { log } from './log.js'

const SENSITIVE_KEY = /password|passphrase|secret|token|authorization|credential/i

/** Recursively replace values of sensitive-looking keys with a placeholder. */
export function redactSensitive(value: unknown): unknown {
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

/**
 * Format a request/response body for logging: redact sensitive fields and
 * truncate. Accepts either a raw JSON string (fetch) or an already-parsed value
 * (axios), and falls back to raw text when a string is not JSON.
 */
export function formatBodyForLog(body: unknown): string {
  if (typeof body === 'string') {
    try {
      return truncate(JSON.stringify(redactSensitive(JSON.parse(body))))
    } catch {
      return truncate(body)
    }
  }
  return truncate(JSON.stringify(redactSensitive(body)))
}

/** Log an outgoing HTTP request. No-op unless CONCRETE_API_DEBUG is on. */
export function logHttpRequest(method: string, url: string, body?: unknown): void {
  if (!apiDebug) return
  log(`HTTP request: ${method} ${url}`)
  if (debugMaxBody > 0 && body !== undefined) {
    log(`HTTP request body: ${formatBodyForLog(body)}`)
  }
}

/** Log an HTTP response. No-op unless CONCRETE_API_DEBUG is on. */
export function logHttpResponse(
  method: string,
  target: string,
  status: number,
  ms: number,
  body?: unknown
): void {
  if (!apiDebug) return
  log(`HTTP response: ${method} ${target} ${status} (${ms}ms)`)
  if (debugMaxBody > 0 && body !== undefined && body !== null && body !== '') {
    log(`HTTP response body: ${formatBodyForLog(body)}`)
  }
}

// --- axios interceptors for the OpenAPI-generated tools -----------------------
//
// The generated tools make their HTTP requests through
// @ivotoby/openapi-mcp-server's internal axios instance (not CmsApiClient), so
// they bypass the helpers above. Installing interceptors on that instance logs
// them the same way. Private fields are accessed defensively: if the library
// internals change, logging is skipped with a warning rather than crashing.

interface AxiosConfigLike {
  method?: string
  url?: string
  baseURL?: string
  params?: Record<string, unknown>
  data?: unknown
  __debugStart?: number
}

interface AxiosResponseLike {
  status: number
  data: unknown
  config: AxiosConfigLike
}

interface AxiosErrorLike {
  response?: AxiosResponseLike
  config?: AxiosConfigLike
}

interface InterceptorManagerLike<T> {
  use(onFulfilled: (value: T) => T, onRejected?: (error: unknown) => unknown): number
}

interface AxiosInstanceLike {
  interceptors: {
    request: InterceptorManagerLike<AxiosConfigLike>
    response: InterceptorManagerLike<AxiosResponseLike>
  }
}

function buildUrl(config: AxiosConfigLike): string {
  const base = (config.baseURL ?? '').replace(/\/+$/, '')
  const path = config.url ?? ''
  let url = base + (path.startsWith('/') ? path : `/${path}`)

  if (config.params && Object.keys(config.params).length > 0) {
    const query = new URLSearchParams(
      Object.entries(config.params)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [key, String(value)])
    ).toString()
    if (query) url += `?${query}`
  }

  return url
}

export function applyLibraryHttpDebug(server: unknown): void {
  if (!apiDebug) return

  const axiosInstance = (server as { apiClient?: { axiosInstance?: AxiosInstanceLike } })?.apiClient
    ?.axiosInstance

  if (!axiosInstance?.interceptors?.request?.use || !axiosInstance.interceptors.response?.use) {
    log('Could not enable HTTP debug for generated tools: unexpected library internals')
    return
  }

  axiosInstance.interceptors.request.use((config) => {
    config.__debugStart = Date.now()
    const method = (config.method ?? 'get').toUpperCase()
    // GET query params are already in the URL; other verbs carry a body in `data`.
    logHttpRequest(method, buildUrl(config), config.data)
    return config
  })

  axiosInstance.interceptors.response.use(
    (response) => {
      const method = (response.config.method ?? 'get').toUpperCase()
      const ms = Date.now() - (response.config.__debugStart ?? Date.now())
      logHttpResponse(method, response.config.url ?? '', response.status, ms, response.data)
      return response
    },
    (error: unknown) => {
      const err = error as AxiosErrorLike
      if (err.response) {
        const config = err.response.config ?? err.config ?? {}
        const method = (config.method ?? 'get').toUpperCase()
        const ms = Date.now() - (config.__debugStart ?? Date.now())
        logHttpResponse(method, config.url ?? '', err.response.status, ms, err.response.data)
      }
      return Promise.reject(error)
    }
  )
}
