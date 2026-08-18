import { debugMaxBody } from './env.js'
import { log } from './log.js'

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

/**
 * Format a request/response body for logging: redact sensitive fields and
 * truncate. Accepts either a raw JSON string (fetch) or an already-parsed value
 * (axios), and falls back to raw text when a string is not JSON.
 */
function formatBodyForLog(body: unknown): string {
  if (typeof body === 'string') {
    try {
      return truncate(JSON.stringify(redactSensitive(JSON.parse(body))))
    } catch {
      return truncate(body)
    }
  }
  return truncate(JSON.stringify(redactSensitive(body)))
}

export enum DebugName {
  ApiCall = 'API call',
}

interface HttpDebugLogger {
  /** Log the request and return its correlation id, to pass to logResponse. */
  logRequest(method: string, url: string, body?: unknown): number
  /** Log the response; method/target are on the matching request line. */
  logResponse(id: number, status: number, ms: number, body?: unknown): void
}

const httpLoggers: Map<DebugName, HttpDebugLogger> = new Map()

// Returns a request/response logger whose lines group under "<label> #N - ...".
export function getHttpLogger(label: DebugName): HttpDebugLogger {
  const existing = httpLoggers.get(label)
  if (existing) {
    return existing
  }

  let counter: number = 0
  const logger: HttpDebugLogger = {
    logRequest(method, url, body) {
      const id = ++counter
      log(`${label} #${id} - Request: ${method} ${url}`)
      if (debugMaxBody > 0 && body !== undefined) {
        log(`${label} #${id} - Request body: ${formatBodyForLog(body)}`)
      }
      return id
    },
    logResponse(id, status, ms, body) {
      log(`${label} #${id} - Response: ${status} (${ms}ms)`)
      if (debugMaxBody > 0 && body !== undefined && body !== null && body !== '') {
        log(`${label} #${id} - Response body: ${formatBodyForLog(body)}`)
      }
    },
  }
  httpLoggers.set(label, logger)
  return logger
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
  __debugSeq?: number
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

export function applyLibraryHttpDebug(debugName: DebugName, server: unknown): void {
  const axiosInstance = (server as { apiClient?: { axiosInstance?: AxiosInstanceLike } })?.apiClient
    ?.axiosInstance

  if (!axiosInstance?.interceptors?.request?.use || !axiosInstance.interceptors.response?.use) {
    log('Could not enable HTTP debug for generated tools: unexpected library internals')
    return
  }

  const httpLog = getHttpLogger(debugName)

  axiosInstance.interceptors.request.use((config) => {
    config.__debugStart = Date.now()
    const method = (config.method ?? 'get').toUpperCase()
    // GET query params are already in the URL; other verbs carry a body in `data`.
    config.__debugSeq = httpLog.logRequest(method, buildUrl(config), config.data)
    return config
  })

  axiosInstance.interceptors.response.use(
    (response) => {
      const ms = Date.now() - (response.config.__debugStart ?? Date.now())
      httpLog.logResponse(response.config.__debugSeq ?? 0, response.status, ms, response.data)
      return response
    },
    (error: unknown) => {
      const err = error as AxiosErrorLike
      if (err.response) {
        const config = err.response.config ?? err.config ?? {}
        const ms = Date.now() - (config.__debugStart ?? Date.now())
        httpLog.logResponse(config.__debugSeq ?? 0, err.response.status, ms, err.response.data)
      }
      return Promise.reject(error)
    }
  )
}
