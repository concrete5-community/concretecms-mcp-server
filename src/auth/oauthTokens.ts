import * as client from 'openid-client'
import { config } from './oidc.js'
import { oauthDebug } from '../env.js'
import { saveTokens, type StoredTokens } from '../tokenStore.js'
import { resolveCmsUserId } from './resolveUser.js'

export type StoredTokensWithParameters = StoredTokens & {
  parameters: Record<string, string>
}

// openid-client wraps oauth4webapi's error as `cause` with the opaque message
// "unexpected JWT claim value encountered". The real detail (which claim, the
// expected vs actual value) lives one level deeper. Surface it so ID token
// validation failures are actionable instead of a dead end.
function enrichTokenError(error: unknown): Error {
  const wrapper = error as { message?: string; cause?: unknown }
  const inner = wrapper?.cause as { message?: string; cause?: unknown } | undefined
  const detail = inner?.cause as
    { claim?: string; expected?: unknown; claims?: Record<string, unknown> } | undefined

  if (detail?.claim) {
    const actual = detail.claims?.[detail.claim]
    let message = `${inner?.message ?? wrapper?.message} [claim="${detail.claim}", expected=${JSON.stringify(detail.expected)}, actual=${JSON.stringify(actual)}]`
    if (oauthDebug && detail.claims) {
      message += ` id_token_claims=${JSON.stringify(detail.claims)}`
    }
    return new Error(message)
  }

  return error instanceof Error ? error : new Error(String(error))
}

export async function exchangeAuthorizationCode(
  callbackUrl: URL,
  codeVerifier: string,
  expectedState?: string | null
): Promise<client.TokenEndpointResponse> {
  try {
    return await client.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: codeVerifier,
      ...(expectedState ? { expectedState } : {}),
    })
  } catch (error) {
    throw enrichTokenError(error)
  }
}

export async function saveTokensForUser(
  tokens: client.TokenEndpointResponse,
  parameters: Record<string, string>,
  intendedUserId?: number
): Promise<{ userId: string; stored: StoredTokensWithParameters }> {
  const now = Date.now()
  const expiresAt = now + tokens.expires_in! * 1000
  const cmsUserId = await resolveCmsUserId(tokens.access_token)

  if (intendedUserId !== undefined && intendedUserId !== cmsUserId) {
    throw new Error(
      `Authorized user (${cmsUserId}) does not match intended user (${intendedUserId})`
    )
  }

  const userId = String(cmsUserId)
  const stored: StoredTokensWithParameters = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token!,
    expires_at: expiresAt,
    obtained_at: now,
    parameters,
    cms_user_id: cmsUserId,
    authorized_at: now,
  }

  saveTokens(userId, stored, parameters)
  return { userId, stored }
}

export async function saveTokensForStdioUser(
  userId: string,
  tokens: client.TokenEndpointResponse,
  parameters: Record<string, string>
): Promise<StoredTokensWithParameters> {
  const now = Date.now()
  const expiresAt = now + tokens.expires_in! * 1000
  const stored: StoredTokensWithParameters = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token!,
    expires_at: expiresAt,
    obtained_at: now,
    parameters,
    authorized_at: now,
  }

  saveTokens(userId, stored, parameters)
  return stored
}
