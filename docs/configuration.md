# Configuration reference

The connector is configured with the settings listed below.
Where you set them depends on how you run it:

| How you run the connector                                   | Where the settings go                         |
| ----------------------------------------------------------- | --------------------------------------------- |
| [Prebuilt extension](local-setup.md#prebuilt-extension)     | The settings form of the extension            |
| [Manual configuration](local-setup.md#manual-configuration) | The `env` block of the entry in the JSON file |
| [Remote server](remote-server.md)                           | The environment variables of the process      |

In the tables:

- **Local** is the connector running on your computer (see [Local configuration](local-setup.md)).
- **Remote** is the connector running on a server (see [Remote server](remote-server.md)).

## Connection to Concrete CMS

| Setting                        | Local    | Remote   | Default | Description                                                                                                               |
| ------------------------------ | -------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| `CONCRETE_CANONICAL_URL`       | Required | Required |         | The URL of your Concrete CMS site                                                                                         |
| `CONCRETE_API_CLIENT_ID`       | Required | Required |         | The Client ID of the [API integration](concrete-api.md)                                                                   |
| `CONCRETE_API_CLIENT_SECRET`   | Required | Required |         | The Client Secret of the API integration                                                                                  |
| `CONCRETE_API_SCOPE`           | Required | Required |         | The [scopes](concrete-api.md#3-choose-the-scopes) to ask for, separated by spaces. Remote: it must include `account:read` |
| `CONCRETE_ALLOW_INSECURE_HTTP` | Optional | Optional | `false` | Set it to `true` if the Concrete CMS site is served over plain HTTP. For development sites only                           |

## Where the connector runs

| Setting           | Local       | Remote   | Default   | Description                                                                                          |
| ----------------- | ----------- | -------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `TRANSPORT_TYPE`  | Leave unset | Required | `stdio`   | Remote: it must be `http`                                                                            |
| `HTTP_PORT`       | Optional    | Optional | `3000`    | Local: the port used during the sign-in (it is part of the Redirect URI). Remote: the listening port |
| `PUBLIC_BASE_URL` | Not used    | Required |           | The public URL of the connector, for example `https://mcp.example.com`                               |
| `HTTP_HOST`       | Not used    | Optional | `0.0.0.0` | The address the connector listens on                                                                 |
| `PATH_PREFIX`     | Not used    | Optional |           | A prefix for all the paths, for example `/ccm-mcp`                                                   |

## Access to the connector

| Setting        | Local    | Remote      | Default | Description                                                                               |
| -------------- | -------- | ----------- | ------- | ----------------------------------------------------------------------------------------- |
| `MCP_API_KEY`  | Not used | Required \* |         | The Bearer token the MCP clients must send                                                |
| `MCP_API_KEYS` | Not used | Required \* |         | A JSON map of API keys to Concrete CMS user IDs, for example `{"my-key":42,"other":null}` |

\* Remote: set either `MCP_API_KEY` or `MCP_API_KEYS`.
See the [Security Guide](security.md#client-authentication) for the details.

## Tokens

| Setting                | Local    | Remote   | Default                     | Description                                                                         |
| ---------------------- | -------- | -------- | --------------------------- | ----------------------------------------------------------------------------------- |
| `TOKEN_DIR`            | Optional | Optional | `~/.concretecms-mcp/tokens` | The directory where the tokens are saved (a subdirectory is created for every site) |
| `TOKEN_ENCRYPTION_KEY` | Optional | Required |                             | The key used to encrypt the saved tokens                                            |
| `CONCRETE_USER_ID`     | Optional | Not used | `local`                     | The name used for the token files                                                   |

Generate a value for `TOKEN_ENCRYPTION_KEY` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Paths

You usually do not need these settings: they change the paths of the remote connector.

| Setting               | Local    | Remote   | Default                        | Description           |
| --------------------- | -------- | -------- | ------------------------------ | --------------------- |
| `MCP_ENDPOINT_PATH`   | Not used | Optional | `{PATH_PREFIX}/mcp`            | The MCP endpoint      |
| `OAUTH_START_PATH`    | Not used | Optional | `{PATH_PREFIX}/oauth/start`    | Starts the sign-in    |
| `OAUTH_CALLBACK_PATH` | Not used | Optional | `{PATH_PREFIX}/oauth/callback` | The Redirect URI path |
| `OAUTH_STATUS_PATH`   | Not used | Optional | `{PATH_PREFIX}/oauth/status`   | The sign-in status    |
| `OAUTH_REVOKE_PATH`   | Not used | Optional | `{PATH_PREFIX}/oauth/revoke`   | Revokes the tokens    |
| `HEALTH_PATH`         | Not used | Optional | `{PATH_PREFIX}/health`         | The health check      |

## Troubleshooting

| Setting              | Local    | Remote   | Default | Description                                                                                        |
| -------------------- | -------- | -------- | ------- | -------------------------------------------------------------------------------------------------- |
| `OAUTH_DEBUG`        | Optional | Optional | `false` | Set it to `true` to log more details about the sign-in                                             |
| `CONCRETE_API_DEBUG` | Optional | Optional | `false` | Set it to `true` to log the requests sent to Concrete CMS and the responses (secrets are redacted) |
| `DEBUG_MAX_BODY`     | Optional | Optional | `2000`  | The maximum number of characters logged for every request and response body (`0` to omit them)     |
