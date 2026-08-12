import * as client from 'openid-client'
import { allowInsecureHttp, canonical_url, client_id, client_secret } from '../env.js'

export const server: client.ServerMetadata = {
  issuer: canonical_url,
  authorization_endpoint: canonical_url + '/oauth/2.0/authorize',
  token_endpoint: canonical_url + '/oauth/2.0/token',
}

export const config: client.Configuration = new client.Configuration(
  server,
  client_id,
  client_secret
)

// openid-client v6 refuses non-HTTPS requests (OAUTH_HTTP_REQUEST_FORBIDDEN).
// When explicitly opted in, relax that restriction so a Concrete server exposed
// over plain HTTP (typically a local/dev instance) can be used.
if (allowInsecureHttp) {
  client.allowInsecureRequests(config)
}
