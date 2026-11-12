import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CHECK,
  checkConnection,
  formatReport,
  type CheckResult,
  type CheckStatus,
  type ConnectionCheckConfig,
  type FetchLike,
} from './connectionCheck.js'

const SITE = 'https://www.example.com'
const REDIRECT_URI = 'http://localhost:3000/callback'

const config: ConnectionCheckConfig = {
  siteUrl: SITE,
  clientId: 'my-client-id',
  redirectUri: REDIRECT_URI,
  scope: 'account:read pages:read',
  remote: false,
  allowInsecureHttp: false,
}

// The answers below are the ones given by a real Concrete CMS 9.5 site.

function oauthError(status: number, error: string, description: string, hint?: string): Response {
  return new Response(
    JSON.stringify({
      error,
      error_description: description,
      ...(hint ? { hint } : {}),
      message: description,
    }),
    { status, headers: { 'Content-Type': 'application/json' } }
  )
}

const tokenNotReadable = () =>
  oauthError(
    401,
    'access_denied',
    'The resource owner or authorization server denied the request.',
    'The JWT string must have two dots'
  )

const headerMissing = () =>
  oauthError(
    401,
    'access_denied',
    'The resource owner or authorization server denied the request.',
    'Missing "Authorization" header'
  )

const html = (status: number, body = '<html><body>Page</body></html>') =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html' } })

const notFound = (concrete = true) =>
  html(
    404,
    concrete
      ? '<html><head><meta name="generator" content="Concrete CMS"></head><body>Page Not Found</body></html>'
      : '<html><body>Not Found</body></html>'
  )

const loginPage = () => html(200, '<html><body><form><input name="uPassword"></form></body></html>')

function scopeRedirect(description: string, hint: string): Response {
  const query = new URLSearchParams({
    error: 'invalid_scope',
    error_description: description,
    hint,
    message: description,
  })
  return new Response(null, { status: 302, headers: { Location: `${REDIRECT_URI}?${query}` } })
}

interface Site {
  api?: () => Response
  apiWithIndexPhp?: () => Response
  authorize?: () => Response
}

function fakeSite(site: Site, requested: string[] = []): FetchLike {
  return async (url) => {
    requested.push(url)
    const { pathname } = new URL(url)
    if (pathname === '/ccm/api/1.0/system/info') {
      return (site.api ?? tokenNotReadable)()
    }
    if (pathname === '/index.php/ccm/api/1.0/system/info') {
      return (site.apiWithIndexPhp ?? notFound)()
    }
    if (pathname === '/oauth/2.0/authorize') {
      return (site.authorize ?? loginPage)()
    }
    throw new Error(`Unexpected request: ${url}`)
  }
}

function statuses(results: CheckResult[]): Record<string, CheckStatus> {
  return Object.fromEntries(results.map((r) => [r.name, r.status]))
}

function find(results: CheckResult[], name: string): CheckResult {
  const result = results.find((r) => r.name === name)
  assert.ok(result, `Missing check: ${name}`)
  return result
}

describe('checkConnection', () => {
  it('passes every check on a site that is set up correctly', async () => {
    const requested: string[] = []
    const results = await checkConnection(config, fakeSite({}, requested))

    assert.deepEqual(statuses(results), {
      [CHECK.reachable]: 'ok',
      [CHECK.prettyUrls]: 'ok',
      [CHECK.api]: 'ok',
      [CHECK.authorizationHeader]: 'ok',
      [CHECK.clientId]: 'ok',
      [CHECK.redirectUri]: 'ok',
      [CHECK.scopes]: 'ok',
    })
    assert.equal(requested.length, 2)

    const authorize = new URL(requested[1])
    assert.equal(authorize.searchParams.get('client_id'), 'my-client-id')
    assert.equal(authorize.searchParams.get('redirect_uri'), REDIRECT_URI)
    assert.equal(authorize.searchParams.get('scope'), 'account:read pages:read')
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256')
  })

  it('reports a site that cannot be reached', async () => {
    const results = await checkConnection(config, async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND www.example.com'), {
          code: 'ENOTFOUND',
        }),
      })
    })

    const reachable = find(results, CHECK.reachable)
    assert.equal(reachable.status, 'failed')
    assert.match(reachable.details ?? '', /ENOTFOUND/)
    assert.equal(find(results, CHECK.clientId).status, 'skipped')
  })

  it('reports a site that answers with a server error', async () => {
    const results = await checkConnection(config, fakeSite({ api: () => html(502) }))

    assert.equal(find(results, CHECK.reachable).status, 'failed')
    assert.match(find(results, CHECK.reachable).details ?? '', /HTTP 502/)
  })

  it('reports a site that redirects the requests', async () => {
    const results = await checkConnection(
      config,
      fakeSite({
        api: () =>
          new Response(null, { status: 301, headers: { Location: 'https://example.com/x' } }),
      })
    )

    assert.equal(find(results, CHECK.reachable).status, 'failed')
    assert.match(find(results, CHECK.reachable).details ?? '', /https:\/\/example\.com\/x/)
  })

  it('reports the pretty URLs that are not enabled', async () => {
    const requested: string[] = []
    const results = await checkConnection(
      config,
      fakeSite({ api: () => notFound(), apiWithIndexPhp: tokenNotReadable }, requested)
    )

    assert.equal(find(results, CHECK.prettyUrls).status, 'failed')
    assert.equal(find(results, CHECK.api).status, 'ok')
    assert.equal(find(results, CHECK.clientId).status, 'skipped')
    assert.equal(requested.length, 2, 'The sign-in page must not be requested')
  })

  it('reports the API that is not enabled in a Concrete CMS site', async () => {
    const results = await checkConnection(config, fakeSite({ api: () => notFound() }))

    const api = find(results, CHECK.api)
    assert.equal(api.status, 'failed')
    assert.match(api.details ?? '', /is a Concrete CMS site, but its API is not enabled/)
    assert.equal(find(results, CHECK.prettyUrls).status, 'skipped')
  })

  it('does not take for granted that the site is Concrete CMS', async () => {
    const results = await checkConnection(
      config,
      fakeSite({ api: () => notFound(false), apiWithIndexPhp: () => notFound(false) })
    )

    const api = find(results, CHECK.api)
    assert.equal(api.status, 'failed')
    assert.match(api.details ?? '', /is not the address of a Concrete CMS site/)
  })

  it('reports the Authorization header removed before reaching Concrete CMS', async () => {
    const results = await checkConnection(config, fakeSite({ api: headerMissing }))

    assert.equal(find(results, CHECK.authorizationHeader).status, 'failed')
    // The integration can be checked anyway
    assert.equal(find(results, CHECK.scopes).status, 'ok')
  })

  it('reports an unknown Client ID', async () => {
    const results = await checkConnection(
      config,
      fakeSite({
        authorize: () => oauthError(400, 'invalid_grant', 'The user credentials were incorrect.'),
      })
    )

    assert.equal(find(results, CHECK.clientId).status, 'failed')
    assert.equal(find(results, CHECK.redirectUri).status, 'skipped')
    assert.equal(find(results, CHECK.scopes).status, 'skipped')
  })

  it('reports a Redirect URI not accepted by the integration', async () => {
    const results = await checkConnection(
      config,
      fakeSite({
        authorize: () => oauthError(401, 'invalid_client', 'Client authentication failed'),
      })
    )

    assert.equal(find(results, CHECK.clientId).status, 'ok')
    const redirectUri = find(results, CHECK.redirectUri)
    assert.equal(redirectUri.status, 'failed')
    assert.match(redirectUri.details ?? '', /http:\/\/localhost:3000\/callback/)
    assert.equal(find(results, CHECK.scopes).status, 'skipped')
  })

  it('lists the scopes unknown to Concrete CMS', async () => {
    const results = await checkConnection(
      config,
      fakeSite({
        authorize: () =>
          scopeRedirect(
            'The requested scope is invalid, unknown, or malformed',
            'Check the `nope-1 nope-2` scope'
          ),
      })
    )

    assert.equal(find(results, CHECK.redirectUri).status, 'ok')
    const scopes = find(results, CHECK.scopes)
    assert.equal(scopes.status, 'failed')
    assert.match(scopes.details ?? '', /does not know these scopes: nope-1, nope-2\.$/)
  })

  it('warns that an older Concrete CMS reports one unknown scope at a time', async () => {
    const results = await checkConnection(
      config,
      fakeSite({
        authorize: () =>
          scopeRedirect(
            'The requested scope is invalid, unknown, or malformed',
            'Check the `nope` scope'
          ),
      })
    )

    assert.match(find(results, CHECK.scopes).details ?? '', /nope\. Older versions/)
  })

  it('lists the scopes not allowed for the integration', async () => {
    const results = await checkConnection(
      config,
      fakeSite({
        authorize: () =>
          scopeRedirect(
            'The requested scope is not allowed for this client',
            'Check the `users:delete users:add` scope'
          ),
      })
    )

    const scopes = find(results, CHECK.scopes)
    assert.equal(scopes.status, 'failed')
    assert.match(scopes.details ?? '', /not allowed to use these scopes: users:delete, users:add\./)
  })

  it('understands the scopes not allowed for the integration in an older Concrete CMS', async () => {
    const results = await checkConnection(
      config,
      fakeSite({
        authorize: () =>
          html(
            500,
            'Invalid scope(s) requested. Please ensure only scopes allowed by the client are requested.'
          ),
      })
    )

    const scopes = find(results, CHECK.scopes)
    assert.equal(scopes.status, 'failed')
    assert.match(scopes.details ?? '', /account:read, pages:read/)
    assert.match(scopes.details ?? '', /does not tell which ones/)
  })

  it('reports the Authorization Code grant type that is not enabled', async () => {
    const results = await checkConnection(
      config,
      fakeSite({
        authorize: () =>
          oauthError(
            400,
            'unsupported_grant_type',
            'The authorization grant type is not supported.'
          ),
      })
    )

    assert.equal(find(results, CHECK.signIn).status, 'failed')
  })

  it('refuses plain HTTP unless it is allowed', async () => {
    const insecure = { ...config, siteUrl: 'http://www.example.com' }

    const refused = await checkConnection(insecure, fakeSite({}))
    assert.equal(find(refused, CHECK.secure).status, 'failed')

    const allowed = await checkConnection({ ...insecure, allowInsecureHttp: true }, fakeSite({}))
    assert.equal(find(allowed, CHECK.secure).status, 'ok')
  })

  it('requires the account:read scope on a server only', async () => {
    const withoutAccount = { ...config, scope: 'pages:read' }

    const local = await checkConnection(withoutAccount, fakeSite({}))
    assert.equal(
      local.some((r) => r.name === CHECK.serverScope),
      false
    )

    const remote = await checkConnection({ ...withoutAccount, remote: true }, fakeSite({}))
    assert.equal(find(remote, CHECK.serverScope).status, 'failed')
  })
})

describe('formatReport', () => {
  it('lists every check with how to fix the failed ones', async () => {
    const results = await checkConnection(config, fakeSite({ api: () => notFound() }))
    const report = formatReport(config, results)

    assert.match(report, /^Connection check for https:\/\/www\.example\.com\n/)
    assert.match(report, /\[OK\] Site reachable/)
    assert.match(report, /\[FAILED\] API enabled\n {4}.+\n {4}How to fix: .+/)
    assert.match(report, /\[NOT CHECKED\] Client ID/)
    assert.match(report, /Problems found: 1\.$/)
  })

  it('says that the Client Secret is not checked when everything is fine', async () => {
    const report = formatReport(config, await checkConnection(config, fakeSite({})))

    assert.match(report, /No problems found\. The Client Secret is not checked here/)
  })
})
