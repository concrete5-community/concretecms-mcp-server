import { createHash } from 'node:crypto'

export type AdminPagePaths = {
  start: string
  status: string
  revoke: string
  health: string
}

export type AdminPage = {
  body: string
  headers: Record<string, string>
}

function hashOf(body: string, tag: string): string {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(body)
  if (!match) {
    throw new Error(`The admin page has no ${tag} element`)
  }
  return createHash('sha256').update(match[1]).digest('base64')
}

export function renderAdminPage(template: string, paths: AdminPagePaths): AdminPage {
  // "<" is escaped so that a path cannot close the script element
  const body = template.replace('__PATHS__', () => JSON.stringify(paths).replace(/</g, '\\u003c'))

  // The page has an inline script and an inline style: only those two are allowed
  const contentSecurityPolicy = [
    "default-src 'none'",
    `script-src 'sha256-${hashOf(body, 'script')}'`,
    `style-src 'sha256-${hashOf(body, 'style')}'`,
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')

  return {
    body,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': contentSecurityPolicy,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  }
}
