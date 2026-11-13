import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ADMIN_PAGE_FILE } from '../paths.js'
import { renderAdminPage } from './adminPage.js'

const template = readFileSync(ADMIN_PAGE_FILE, 'utf8')

const paths = {
  start: '/oauth/start',
  status: '/oauth/status',
  revoke: '/oauth/revoke',
  health: '/health',
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('base64')
}

function inner(body: string, tag: string): string {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(body)
  assert.ok(match, `the page has a ${tag} element`)
  return match[1]
}

test('the policy allows only the script and the style of the page', () => {
  const page = renderAdminPage(template, paths)
  const policy = page.headers['Content-Security-Policy']

  assert.ok(policy.includes("default-src 'none'"))
  assert.ok(policy.includes(`script-src 'sha256-${sha256(inner(page.body, 'script'))}'`))
  assert.ok(policy.includes(`style-src 'sha256-${sha256(inner(page.body, 'style'))}'`))
  assert.ok(policy.includes("connect-src 'self'"))
  assert.ok(policy.includes("frame-ancestors 'none'"))
})

test('the page calls the paths of the connector', () => {
  const page = renderAdminPage(template, { ...paths, start: '/ccm-mcp/oauth/start' })

  assert.ok(page.body.includes('"start":"/ccm-mcp/oauth/start"'))
  assert.ok(page.body.includes('"health":"/health"'))
  assert.ok(!page.body.includes('__PATHS__'))
})

test('a path cannot close the script element', () => {
  const page = renderAdminPage(template, { ...paths, start: '/</script><script>alert(1)//' })

  assert.equal(page.body.match(/<script>/g)?.length, 1)
  assert.equal(page.body.match(/<\/script>/g)?.length, 1)
})

test('the page has one script and one style, both inline', () => {
  assert.equal(template.match(/<script/g)?.length, 1)
  assert.equal(template.match(/<style/g)?.length, 1)
  assert.doesNotMatch(template, /\b(src|href|style|on\w+)\s*=\s*["']/)
})

test('the page does not store the key', () => {
  assert.doesNotMatch(template, /localStorage|sessionStorage|indexedDB|document\.cookie/)
})

test('the page is not cached', () => {
  assert.equal(renderAdminPage(template, paths).headers['Cache-Control'], 'no-store')
})
