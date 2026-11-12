import { createHash, randomBytes } from 'node:crypto'

export type CheckStatus = 'ok' | 'failed' | 'skipped'

export interface CheckResult {
  name: string
  status: CheckStatus
  details?: string
  fix?: string
}

export interface ConnectionCheckConfig {
  siteUrl: string
  clientId: string
  redirectUri: string
  scope: string
  /** The connector runs on a server (http transport) */
  remote: boolean
  allowInsecureHttp: boolean
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export const CHECK = {
  secure: 'Secure connection',
  reachable: 'Site reachable',
  prettyUrls: 'Pretty URLs enabled',
  api: 'API enabled',
  authorizationHeader: 'Authorization header received by Concrete CMS',
  signIn: 'Sign-in page',
  clientId: 'Client ID',
  redirectUri: 'Redirect URI',
  scopes: 'Scopes',
  serverScope: 'Scope required on a server',
} as const

const API_PROBE_PATH = '/ccm/api/1.0/system/info'
const AUTHORIZE_PATH = '/oauth/2.0/authorize'
const TIMEOUT_MS = 10_000
// Not a real token: Concrete must answer that it cannot read it, which proves it received it.
const PROBE_TOKEN = 'connection-check'

interface ProbeResponse {
  status: number
  location: string | null
  body: string
  json: Record<string, unknown> | null
}

async function probe(
  fetchFn: FetchLike,
  url: string,
  headers: Record<string, string>
): Promise<ProbeResponse> {
  const response = await fetchFn(url, {
    method: 'GET',
    headers,
    // The redirects are answers to inspect, not to follow.
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const body = await response.text()
  let json: Record<string, unknown> | null = null
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      json = parsed as Record<string, unknown>
    }
  } catch {
    // Not JSON
  }

  return { status: response.status, location: response.headers.get('location'), body, json }
}

function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'unknown error'
  }
  if (error.name === 'TimeoutError') {
    return `no answer within ${TIMEOUT_MS / 1000} seconds`
  }
  const cause = (error as { cause?: unknown }).cause
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code
    return typeof code === 'string' ? `${cause.message} (${code})` : cause.message
  }
  return error.message
}

function stringField(data: Record<string, unknown> | null, name: string): string {
  const value = data?.[name]
  return typeof value === 'string' ? value : ''
}

/** The answer Concrete gives to an API request it does not authorize. */
function isApiRefusal(response: ProbeResponse): boolean {
  return response.status === 401 && stringField(response.json, 'error') !== ''
}

function skipped(names: string[], details: string): CheckResult[] {
  return names.map((name) => ({ name, status: 'skipped', details }))
}

function scopeList(scope: string): string[] {
  return scope.split(/\s+/).filter(Boolean)
}

/** Scope names as Concrete reports them: "Check the `a b` scope". */
function scopesFromHint(hint: string): string[] {
  const match = /`([^`]*)`/.exec(hint)
  return match ? scopeList(match[1]) : []
}

function buildAuthorizeUrl(config: ConnectionCheckConfig): string {
  const verifier = randomBytes(32).toString('base64url')
  const url = new URL(`${config.siteUrl}${AUTHORIZE_PATH}`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('scope', config.scope)
  url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'))
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', randomBytes(16).toString('hex'))
  return url.toString()
}

async function checkSite(
  config: ConnectionCheckConfig,
  fetchFn: FetchLike
): Promise<CheckResult[]> {
  const afterReachable = [CHECK.prettyUrls, CHECK.api, CHECK.authorizationHeader]
  const probeUrl = `${config.siteUrl}${API_PROBE_PATH}`
  const headers = { Authorization: `Bearer ${PROBE_TOKEN}`, Accept: 'application/json' }

  let response: ProbeResponse
  try {
    response = await probe(fetchFn, probeUrl, headers)
  } catch (error) {
    return [
      {
        name: CHECK.reachable,
        status: 'failed',
        details: `${config.siteUrl} cannot be reached: ${describeNetworkError(error)}.`,
        fix: 'Check the Canonical URL (CONCRETE_CANONICAL_URL), and that the site is online and reachable from where the connector runs.',
      },
      ...skipped(afterReachable, 'The site cannot be reached.'),
    ]
  }

  if (response.status >= 500) {
    return [
      {
        name: CHECK.reachable,
        status: 'failed',
        details: `${config.siteUrl} answers with a server error (HTTP ${response.status}).`,
        fix: 'The site is not working properly: check it in a browser.',
      },
      ...skipped(afterReachable, 'The site answers with a server error.'),
    ]
  }

  if (response.status >= 300 && response.status < 400) {
    return [
      {
        name: CHECK.reachable,
        status: 'failed',
        details: `${config.siteUrl} redirects the requests to ${response.location ?? 'another address'}.`,
        fix: 'Use the final address of the site as the Canonical URL (CONCRETE_CANONICAL_URL).',
      },
      ...skipped(afterReachable, 'The site redirects the requests.'),
    ]
  }

  const results: CheckResult[] = [{ name: CHECK.reachable, status: 'ok' }]

  if (isApiRefusal(response)) {
    results.push({ name: CHECK.prettyUrls, status: 'ok' }, { name: CHECK.api, status: 'ok' })
    results.push(checkAuthorizationHeader(response))
    return results
  }

  if (response.status !== 404) {
    results.push(
      ...skipped([CHECK.prettyUrls], 'The API gave an unexpected answer.'),
      {
        name: CHECK.api,
        status: 'failed',
        details: `${probeUrl} gave an unexpected answer (HTTP ${response.status}).`,
        fix: 'Something between the connector and Concrete CMS (for example a firewall, or a password protecting the site) may be handling the request.',
      },
      ...skipped([CHECK.authorizationHeader], 'The API gave an unexpected answer.')
    )
    return results
  }

  // Not found: either the API is off, or it only answers with /index.php in the address.
  let withIndexPhp: ProbeResponse | null = null
  try {
    withIndexPhp = await probe(fetchFn, `${config.siteUrl}/index.php${API_PROBE_PATH}`, headers)
  } catch {
    // Same diagnosis as an API that does not answer
  }

  if (withIndexPhp && isApiRefusal(withIndexPhp)) {
    results.push(
      {
        name: CHECK.prettyUrls,
        status: 'failed',
        details: 'The API answers only when the address contains /index.php.',
        fix: 'In the Concrete CMS dashboard go to System & Settings > SEO & Statistics > URLs and Redirection, and enable "Remove index.php from URLs" (Pretty URLs).',
      },
      { name: CHECK.api, status: 'ok' },
      ...skipped([CHECK.authorizationHeader], 'The pretty URLs are not enabled.')
    )
    return results
  }

  const isConcrete = /<meta\s+name="generator"\s+content="Concrete CMS"/i.test(response.body)
  results.push(...skipped([CHECK.prettyUrls], 'The API does not answer.'), {
    name: CHECK.api,
    status: 'failed',
    details: isConcrete
      ? `${config.siteUrl} is a Concrete CMS site, but its API is not enabled.`
      : `The API does not answer at ${probeUrl}: either the API is not enabled, or ${config.siteUrl} is not the address of a Concrete CMS site.`,
    fix: isConcrete
      ? 'In the Concrete CMS dashboard go to System & Settings > API, and enable the API.'
      : 'Check the Canonical URL (CONCRETE_CANONICAL_URL). If it is right, in the Concrete CMS dashboard go to System & Settings > API, and enable the API.',
  })
  results.push(...skipped([CHECK.authorizationHeader], 'The API does not answer.'))
  return results
}

function checkAuthorizationHeader(response: ProbeResponse): CheckResult {
  const hint = stringField(response.json, 'hint')
  if (hint === '') {
    return {
      name: CHECK.authorizationHeader,
      status: 'skipped',
      details: 'This version of Concrete CMS does not tell whether it received the header.',
    }
  }
  if (/missing\s+"?authorization"?\s+header/i.test(hint)) {
    return {
      name: CHECK.authorizationHeader,
      status: 'failed',
      details:
        'The connector sent the Authorization header, but Concrete CMS did not receive it: the web server (or a proxy) removes it.',
      fix: 'Configure the web server to pass the Authorization header to PHP. With Apache, add "CGIPassAuth On" (or: SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1) to the .htaccess file of the site.',
    }
  }
  return { name: CHECK.authorizationHeader, status: 'ok' }
}

function integrationResults(
  failedCheck: string,
  failure: Pick<CheckResult, 'details' | 'fix'>
): CheckResult[] {
  const order = [CHECK.clientId, CHECK.redirectUri, CHECK.scopes]
  const failedIndex = order.indexOf(failedCheck as (typeof order)[number])
  return order.map((name, index): CheckResult => {
    if (index < failedIndex) {
      return { name, status: 'ok' }
    }
    if (index === failedIndex) {
      return { name, status: 'failed', ...failure }
    }
    return { name, status: 'skipped', details: `Not checked: fix "${failedCheck}" first.` }
  })
}

function scopeFailure(
  config: ConnectionCheckConfig,
  error: { description: string; hint: string }
): Pick<CheckResult, 'details' | 'fix'> {
  const names = scopesFromHint(error.hint)
  const list = names.length > 0 ? names.join(', ') : '(not specified by Concrete CMS)'

  if (/not allowed/i.test(error.description)) {
    return {
      details: `The API integration is not allowed to use these scopes: ${list}.`,
      fix: 'Enable them in the integration (System & Settings > API > Integrations), or remove them from the scopes of the connector (CONCRETE_API_SCOPE).',
    }
  }
  return {
    details:
      `Concrete CMS does not know these scopes: ${list}.` +
      // Concrete CMS reported just the first unknown scope until this was fixed in its core.
      (names.length === 1
        ? ' Older versions of Concrete CMS report only the first one, so there may be others.'
        : ''),
    fix: `Fix or remove them in the scopes of the connector (CONCRETE_API_SCOPE). The scopes available in this site are listed at ${config.siteUrl}/dashboard/system/api/scopes`,
  }
}

async function checkIntegration(
  config: ConnectionCheckConfig,
  fetchFn: FetchLike
): Promise<CheckResult[]> {
  let response: ProbeResponse
  try {
    response = await probe(fetchFn, buildAuthorizeUrl(config), {
      Accept: 'text/html,application/json',
    })
  } catch (error) {
    return [
      {
        name: CHECK.signIn,
        status: 'failed',
        details: `The sign-in page of Concrete CMS cannot be reached: ${describeNetworkError(error)}.`,
      },
    ]
  }

  if (response.status === 200) {
    return [CHECK.clientId, CHECK.redirectUri, CHECK.scopes].map((name) => ({ name, status: 'ok' }))
  }

  // Wrong scopes are reported to the client, that is with a redirect to the Redirect URI.
  let error = {
    type: stringField(response.json, 'error'),
    description: stringField(response.json, 'error_description'),
    hint: stringField(response.json, 'hint'),
  }
  if (response.status >= 300 && response.status < 400 && response.location) {
    let query: URLSearchParams | null = null
    try {
      query = new URL(response.location).searchParams
    } catch {
      // Not an absolute address: not an OAuth error
    }
    error = {
      type: query?.get('error') ?? '',
      description: query?.get('error_description') ?? '',
      hint: query?.get('hint') ?? '',
    }
  }

  switch (error.type) {
    case 'invalid_grant':
    // Name used by older versions of the OAuth library of Concrete CMS
    case 'invalid_credentials':
      return integrationResults(CHECK.clientId, {
        details: `Concrete CMS does not know the Client ID ${config.clientId}.`,
        fix: 'Copy the Client ID again from the API integration (System & Settings > API > Integrations), and check that the Canonical URL is the one of the site where you created the integration.',
      })
    case 'invalid_client':
      return integrationResults(CHECK.redirectUri, {
        details: `The API integration does not accept the Redirect URI ${config.redirectUri}`,
        fix: 'Add exactly this address to the Redirect URI of the API integration (System & Settings > API > Integrations).',
      })
    case 'invalid_scope':
      return integrationResults(CHECK.scopes, scopeFailure(config, error))
    case 'unsupported_grant_type':
      return [
        {
          name: CHECK.signIn,
          status: 'failed',
          details: 'Concrete CMS does not accept the "Authorization Code" grant type.',
          fix: 'In the Concrete CMS dashboard go to System & Settings > API, and enable it in the "Enabled Grant Types".',
        },
      ]
  }

  // Before listing them, Concrete CMS answered this way to the scopes not allowed for the integration.
  if (response.status === 500 && /invalid scope/i.test(response.body)) {
    return integrationResults(CHECK.scopes, {
      details: `The API integration is not allowed to use one or more of the requested scopes (${scopeList(config.scope).join(', ')}): this version of Concrete CMS does not tell which ones.`,
      fix: 'Enable them in the integration (System & Settings > API > Integrations), or remove them from the scopes of the connector (CONCRETE_API_SCOPE).',
    })
  }

  const answer = [error.type, error.description, error.hint].filter(Boolean).join(' - ')
  return [
    {
      name: CHECK.signIn,
      status: 'failed',
      details: `The sign-in page of Concrete CMS gave an unexpected answer (HTTP ${response.status})${answer ? `: ${answer}` : ''}.`,
    },
  ]
}

export async function checkConnection(
  config: ConnectionCheckConfig,
  fetchFn: FetchLike = fetch
): Promise<CheckResult[]> {
  const results: CheckResult[] = []

  if (config.siteUrl.toLowerCase().startsWith('http://')) {
    results.push(
      config.allowInsecureHttp
        ? {
            name: CHECK.secure,
            status: 'ok',
            details: 'The site uses plain HTTP, which is allowed by the settings of the connector.',
          }
        : {
            name: CHECK.secure,
            status: 'failed',
            details: 'The site uses plain HTTP: the connector refuses to sign in without HTTPS.',
            fix: 'Use the https:// address of the site. For a development site only, you can enable "Allow insecure HTTP" (CONCRETE_ALLOW_INSECURE_HTTP).',
          }
    )
  }

  if (config.remote) {
    results.push(
      scopeList(config.scope).includes('account:read')
        ? { name: CHECK.serverScope, status: 'ok' }
        : {
            name: CHECK.serverScope,
            status: 'failed',
            details: 'The scopes of the connector do not include account:read.',
            fix: 'Add account:read to the scopes of the connector (CONCRETE_API_SCOPE): a connector running on a server needs it to know which user signed in.',
          }
    )
  }

  const siteResults = await checkSite(config, fetchFn)
  results.push(...siteResults)

  const apiAnswers = siteResults.some((r) => r.name === CHECK.api && r.status === 'ok')
  const prettyUrls = siteResults.some((r) => r.name === CHECK.prettyUrls && r.status === 'ok')
  if (apiAnswers && prettyUrls) {
    results.push(...(await checkIntegration(config, fetchFn)))
  } else {
    results.push(
      ...skipped(
        [CHECK.clientId, CHECK.redirectUri, CHECK.scopes],
        'Not checked: fix the problems above first.'
      )
    )
  }

  return results
}

const STATUS_LABEL: Record<CheckStatus, string> = {
  ok: 'OK',
  failed: 'FAILED',
  skipped: 'NOT CHECKED',
}

export function formatReport(config: ConnectionCheckConfig, results: CheckResult[]): string {
  const lines = [`Connection check for ${config.siteUrl}`, '']
  for (const result of results) {
    lines.push(`[${STATUS_LABEL[result.status]}] ${result.name}`)
    if (result.details) {
      lines.push(`    ${result.details}`)
    }
    if (result.fix) {
      lines.push(`    How to fix: ${result.fix}`)
    }
  }

  const failed = results.filter((r) => r.status === 'failed').length
  lines.push('')
  if (failed > 0) {
    lines.push(`Problems found: ${failed}.`)
  } else if (results.some((r) => r.status === 'skipped')) {
    lines.push('No problems found, but some checks could not be done.')
  } else {
    lines.push(
      'No problems found. The Client Secret is not checked here: it is verified when you sign in.'
    )
  }

  return lines.join('\n')
}
