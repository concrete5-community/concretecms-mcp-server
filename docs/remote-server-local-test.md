# Try the remote connector on your computer

This page is for developers who want to try the remote connector, or their own AI agent, without installing anything on a server.
To install the connector on a server, see [Remote server](remote-server.md).

Before deploying to a remote server, you can run the same HTTP transport on your development machine to verify that your AI agent or MCP client connects correctly. No reverse proxy is required — the server listens directly on `127.0.0.1:3000` (or whatever you set in `HTTP_HOST` / `HTTP_PORT`).

## 1. Build the server

```bash
npm ci && npm run build
```

## 2. Register a local OAuth redirect URI

In your Concrete CMS API integration, add this redirect URI (it must match `${PUBLIC_BASE_URL}${OAUTH_CALLBACK_PATH}` exactly):

```
http://127.0.0.1:3000/oauth/callback
```

If you use a different `PUBLIC_BASE_URL`, `HTTP_PORT`, or `PATH_PREFIX`, adjust the URI accordingly. For example, with `PATH_PREFIX=/ccm-mcp` the callback is `http://127.0.0.1:3000/ccm-mcp/oauth/callback`.

## 3. Start the server

HTTP mode requires **four extra variables** beyond the `CONCRETE_*` settings (see the [Configuration reference](configuration.md)): `TRANSPORT_TYPE=http`, `PUBLIC_BASE_URL`, `TOKEN_ENCRYPTION_KEY`, and `MCP_API_KEY`.

**Option A — single line (recommended for quick tests):**

```bash
TRANSPORT_TYPE=http \
PUBLIC_BASE_URL=http://127.0.0.1:3000 \
TOKEN_ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" \
MCP_API_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" \
CONCRETE_CANONICAL_URL=https://cms.example.com \
CONCRETE_API_CLIENT_ID=YOUR_API_CLIENT_ID \
CONCRETE_API_CLIENT_SECRET=YOUR_API_CLIENT_SECRET \
CONCRETE_API_SCOPE="account:read system:info:read" \
npm run start
```

**Option B — `.env` file (recommended for repeated local testing):**

```bash
cp .env.example .env
```

Edit `.env` for local HTTP mode:

```bash
TRANSPORT_TYPE=http
PUBLIC_BASE_URL=http://127.0.0.1:3000
HTTP_HOST=127.0.0.1
HTTP_PORT=3000
CONCRETE_CANONICAL_URL=https://cms.example.com
CONCRETE_API_CLIENT_ID=YOUR_API_CLIENT_ID
CONCRETE_API_CLIENT_SECRET=YOUR_API_CLIENT_SECRET
CONCRETE_API_SCOPE=account:read system:info:read
TOKEN_ENCRYPTION_KEY=your-base64-key
MCP_API_KEY=your-mcp-api-key
```

Load and start:

```bash
set -a && source .env && set +a && npm run start
```

> **Note:** The server does not load `.env` automatically. You must export the variables (as above) or pass them inline when starting.

## 4. Confirm HTTP mode started

Check the terminal output. A successful local HTTP start looks like:

```
[concretecms-mcp] Starting MCP server (http transport)...
[concretecms-mcp] Remote MCP server running at http://127.0.0.1:3000/mcp
[concretecms-mcp] OAuth start URL: http://127.0.0.1:3000/oauth/start
[concretecms-mcp] Remote MCP server ready. Authorize users via /oauth/start
```

If you see `(stdio transport)` instead, the server is **not** listening on HTTP and `http://127.0.0.1:3000/health` will not work. The most common cause is `TRANSPORT_TYPE=http` not being set — often due to a broken multiline shell command (see troubleshooting below).

## 5. Smoke-test endpoints

**Health check** (no authentication required):

```bash
curl http://127.0.0.1:3000/health
```

Expected response:

```json
{ "status": "healthy" }
```

**OAuth status** (requires API key):

```bash
curl -H "Authorization: Bearer $MCP_API_KEY" \
  "http://127.0.0.1:3000/oauth/status?user_id=42"
```

**Start OAuth for a user** (simulates a backend proxy — expect `state=` in `Location`):

```bash
curl -s -D - -o /dev/null -H "Authorization: Bearer $MCP_API_KEY" \
  "http://127.0.0.1:3000/oauth/start?user_id=42"
```

You can also run `npm run verify:oauth` to confirm the shipped `dist/` uses state-based session binding.

**OAuth debug mode** (recommended while troubleshooting callback failures):

```bash
OAUTH_DEBUG=1 npm run start
```

When enabled, the browser callback page shows a `Reason:` code and details. The MCP server always logs the same reason to stderr, for example:

| Reason                       | Meaning                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `no_pending_sessions`        | MCP has no in-memory OAuth session (server restarted, flow expired, or `/oauth/start` never reached this process) |
| `pkce_match_failed`          | Callback arrived, but token exchange failed for every pending session — see per-session errors in logs            |
| `user_id_mismatch`           | Token exchange succeeded, but the CMS account that approved OAuth is not the `user_id` from `/oauth/start`        |
| `resolve_cms_user_failed`    | Token exchange succeeded, but `/ccm/api/1.0/account` could not be read with the new access token                  |
| `oauth_provider_error`       | CMS redirected with `error=` instead of `code=`                                                                   |
| `missing_authorization_code` | Callback reached MCP without a `code` query parameter                                                             |

## 6. Connect your AI agent

Point your agent or MCP client at the local server:

```
MCP_SERVER_URL=http://127.0.0.1:3000
```

Send these headers on every `/mcp` request (see the **[Developer guide](mcp-client-guide.md)** for the full protocol):

```
Authorization: Bearer <MCP_API_KEY>
X-Concrete-User-Id: <cms_user_id>
```

Authorize the CMS user via `/oauth/start` before calling tools. Poll `/oauth/status?user_id=<id>` to confirm authentication.

## Troubleshooting local HTTP mode

| Symptom                                                       | Likely cause                                                                   | Fix                                                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `http://127.0.0.1:3000/health` connection refused             | Server running in stdio mode (default)                                         | Set `TRANSPORT_TYPE=http` and restart                                                                              |
| Terminal shows `(stdio transport)`                            | `TRANSPORT_TYPE` not exported                                                  | Use the single-line command or `set -a && source .env`                                                             |
| `Missing required environment variable: TOKEN_ENCRYPTION_KEY` | HTTP secrets not set                                                           | Set `TOKEN_ENCRYPTION_KEY` and `MCP_API_KEY`                                                                       |
| `zsh: command not found: I` (or similar)                      | Extra text on an env-var line                                                  | Each line must be only `VAR=value` — no trailing words                                                             |
| `TRANSPORT_TYPE` set but still stdio                          | `VAR=value other-command` syntax                                               | `TOKEN_ENCRYPTION_KEY=xxx npm run start` sets the var only for that command; use `export` or `source .env` instead |
| Broken multiline command                                      | Missing `\` at end of a line                                                   | Every continued line except the last must end with `\`                                                             |
| OAuth redirect mismatch                                       | `PUBLIC_BASE_URL` differs from registered URI                                  | Register `http://127.0.0.1:3000/oauth/callback` in CMS and match `PUBLIC_BASE_URL`                                 |
| Port already in use                                           | Another process on port 3000                                                   | Change `HTTP_PORT` and update `PUBLIC_BASE_URL` accordingly                                                        |
| OAuth callback **400** — Authorization could not be completed | See MCP server logs for `OAuth callback failed: <reason>`                      | Restart with `OAUTH_DEBUG=1` to show the reason in the browser                                                     |
| Authorize URL missing `state`                                 | Running outdated `dist/`                                                       | `npm run build && npm run verify:oauth`, then restart                                                              |
| Callback 400 with `state` present                             | Client modified MCP `Location` URL, multiple MCP processes, or expired session | Forward `Location` unchanged; `lsof -nP -iTCP:3000 -sTCP:LISTEN`; complete flow within 10 minutes                  |
| `/oauth/start` 409                                            | Concurrent OAuth for same user                                                 | Wait or call `/oauth/revoke`                                                                                       |
