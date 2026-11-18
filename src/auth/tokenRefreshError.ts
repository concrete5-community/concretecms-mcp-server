import * as client from 'openid-client'
import { redactError } from '../utils/redact.js'

// The errors Concrete CMS answers with when a refresh token cannot be used anymore
const REFUSED_TOKEN_ERRORS = ['invalid_grant', 'invalid_request']

const MAX_DETAIL_LENGTH = 200

/** The saved authorization of a user cannot be renewed: only a new sign-in gives new tokens. */
export class AuthorizationRefusedError extends Error {
  constructor() {
    super(
      'Concrete CMS no longer accepts the saved authorization of this user: the user must be authorized again.'
    )
    this.name = 'AuthorizationRefusedError'
  }
}

export function isRefusedRefreshToken(error: unknown): boolean {
  return error instanceof client.ResponseBodyError && REFUSED_TOKEN_ERRORS.includes(error.error)
}

function clean(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_DETAIL_LENGTH)
    : ''
}

/** What Concrete CMS answered to a failed token request, for the log. */
export function describeTokenError(error: unknown): string {
  if (!(error instanceof client.ResponseBodyError)) {
    return redactError(error)
  }

  let description = `${clean(error.error)} (HTTP ${error.status})`
  const details = [clean(error.error_description), clean(error.cause.hint)].filter(Boolean)
  if (details.length > 0) {
    description += `: ${details.join(' - ')}`
  }

  return description
}
