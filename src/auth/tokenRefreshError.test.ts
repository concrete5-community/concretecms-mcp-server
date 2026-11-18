import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as client from 'openid-client'
import {
  AuthorizationRefusedError,
  describeTokenError,
  isRefusedRefreshToken,
} from './tokenRefreshError.js'

function tokenError(status: number, body: Record<string, string>): client.ResponseBodyError {
  return new client.ResponseBodyError('server responded with an error in the response body', {
    cause: body as { error: string },
    response: new Response(JSON.stringify(body), { status }),
  })
}

const revoked = tokenError(401, {
  error: 'invalid_request',
  error_description: 'The refresh token is invalid.',
  hint: 'Token has been revoked',
  message: 'The refresh token is invalid.',
})

test('the log tells why Concrete CMS refused the token', () => {
  assert.equal(
    describeTokenError(revoked),
    'invalid_request (HTTP 401): The refresh token is invalid. - Token has been revoked'
  )
})

test('the log copes with an answer without details', () => {
  assert.equal(
    describeTokenError(tokenError(400, { error: 'invalid_grant' })),
    'invalid_grant (HTTP 400)'
  )
})

test('the details are written on one line, and they are not too long', () => {
  const description = describeTokenError(
    tokenError(401, { error: 'invalid_request', hint: `first\nsecond ${'x'.repeat(500)}` })
  )

  assert.ok(description.startsWith('invalid_request (HTTP 401): first second x'))
  assert.ok(!description.includes('\n'))
  assert.ok(description.length < 260)
})

test('the other errors are described by their message', () => {
  assert.equal(describeTokenError(new TypeError('fetch failed')), 'fetch failed')
})

test('a refresh token is refused only when Concrete CMS says so', () => {
  assert.equal(isRefusedRefreshToken(revoked), true)
  assert.equal(isRefusedRefreshToken(tokenError(400, { error: 'invalid_grant' })), true)
  // A wrong Client Secret, or a site that cannot be reached: a new sign-in would not help
  assert.equal(isRefusedRefreshToken(tokenError(401, { error: 'invalid_client' })), false)
  assert.equal(isRefusedRefreshToken(new TypeError('fetch failed')), false)
})

test('the AI agent is told that the user must be authorized again', () => {
  assert.match(new AuthorizationRefusedError().message, /must be authorized again/)
})
