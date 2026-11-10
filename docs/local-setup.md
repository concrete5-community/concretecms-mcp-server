# Local configuration

The connector runs on your computer: your AI agent (for example Claude Desktop) starts it when needed.
There is nothing to install on any server.

## Choose how to install

|                | With the prebuilt extension               | By manual configuration                       |
| -------------- | ----------------------------------------- | --------------------------------------------- |
| Concrete sites | One                                       | One or more                                   |
| AI agents      | Claude Desktop                            | Any agent using the `mcpServers` format       |
| What you need  | Just the `.mcpb` file                     | Git and Node.js 22 or later                   |
| How to proceed | [Prebuilt extension](#prebuilt-extension) | [Manual configuration](#manual-configuration) |

## Prebuilt extension

1. [Set up the Concrete CMS API](concrete-api.md) in your site, using `http://localhost:3000/callback` as the Redirect URI.
2. Download the `concretecms-mcp-server.mcpb` file from the [latest release](https://github.com/concrete5-community/concretecms-mcp-server/releases/latest).
3. In Claude Desktop, go to _Settings_ > _Desktop app_ > select _Manage_ next to _Extensions_.
4. Click _Advanced settings_.
5. In the _Extension Developer_ section, click _Install Extension_ and select the downloaded file.

Claude Desktop then asks for the settings:

| Field                         | Value                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------- |
| Canonical URL                 | The URL of your Concrete CMS site                                               |
| API Integration Client ID     | The Client ID of the API integration                                            |
| API Integration Client Secret | The Client Secret of the API integration                                        |
| API Integration Client Scopes | The [scopes](concrete-api.md#3-choose-the-scopes) you want, separated by spaces |

You can leave the other fields empty.
See the [Configuration reference](configuration.md) for their meaning.

## Manual configuration

### Build the connector

You need [Git](https://git-scm.com/install) and [Node.js](https://nodejs.org/en/download) 22 or later.

```bash
git clone https://github.com/concrete5-community/concretecms-mcp-server.git
cd concretecms-mcp-server
npm ci && npm run build
```

You have to do this only once, even if you connect to several sites.

### Find the JSON configuration file of your AI agent

You have to manually edit the JSON configuration file of your AI agent: it is the file that lists the MCP servers the agent can use.

To locate it:

- Claude Desktop: go to _Settings_ > _Desktop app_ > select _Manage_ next to _Extensions_ > click the _Edit config_ button.
- Other AI agents: check their documentation.

### Single-site configuration

#### 1. Set up the Concrete CMS API

[Set up the Concrete CMS API](concrete-api.md) in your site, using this Redirect URI:

```
http://localhost:3000/callback
```

#### 2. Configure your AI agent

Edit the JSON configuration file of your AI agent.
The `mcpServers` format below is understood by most AI agents (Claude Desktop, Cursor, Cline, and others).

```json
{
  "mcpServers": {
    "concretecms": {
      "command": "node",
      "args": ["/path/to/concretecms-mcp-server/dist/index.js"],
      "env": {
        "CONCRETE_CANONICAL_URL": "https://your-concrete.example",
        "CONCRETE_API_CLIENT_ID": "YOUR_API_CLIENT_ID",
        "CONCRETE_API_CLIENT_SECRET": "YOUR_API_CLIENT_SECRET",
        "CONCRETE_API_SCOPE": "account:read system:info:read"
      }
    }
  }
}
```

If the file already defines other servers, add `concretecms` as another entry under `mcpServers`, without replacing the whole object.
On Windows, write the path with forward slashes (`C:/path/to/...`) or with doubled backslashes (`C:\\path\\to\\...`).

See the [Configuration reference](configuration.md) for all the settings you can add to `env`.
For more information about local MCP servers, see the [MCP documentation](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

#### 3. Restart your AI agent

The connector is started the next time the AI agent runs.

### Multi-site configuration

Follow the same steps as for a [single site](#single-site-configuration), with these differences:

- For every site, [set up the Concrete CMS API](concrete-api.md) using a different port in the Redirect URI.
  For example, for site A you can use
  ```
  http://localhost:3000/callback
  ```
  and for site B you can use
  ```
  http://localhost:3001/callback
  ```
- Add one entry per site to the JSON configuration file, all pointing to the same `dist/index.js`, each with its own `HTTP_PORT`, set to the port used in the Redirect URI of that site.

For example:

```json
{
  "mcpServers": {
    "concretecms-site-a": {
      "command": "node",
      "args": ["/path/to/concretecms-mcp-server/dist/index.js"],
      "env": {
        "CONCRETE_CANONICAL_URL": "https://site-a.example",
        "CONCRETE_API_CLIENT_ID": "CLIENT_ID_OF_SITE_A",
        "CONCRETE_API_CLIENT_SECRET": "CLIENT_SECRET_OF_SITE_A",
        "CONCRETE_API_SCOPE": "account:read system:info:read",
        "HTTP_PORT": "3000"
      }
    },
    "concretecms-site-b": {
      "command": "node",
      "args": ["/path/to/concretecms-mcp-server/dist/index.js"],
      "env": {
        "CONCRETE_CANONICAL_URL": "https://site-b.example",
        "CONCRETE_API_CLIENT_ID": "CLIENT_ID_OF_SITE_B",
        "CONCRETE_API_CLIENT_SECRET": "CLIENT_SECRET_OF_SITE_B",
        "CONCRETE_API_SCOPE": "account:read system:info:read",
        "HTTP_PORT": "3001"
      }
    }
  }
}
```

Every entry is a separate connector, with its own tools and its own sign-in.
Give the entries names that let you tell the sites apart.

## First use

The first time you ask something that needs your site, a browser window opens: sign in to Concrete CMS and authorize the requested scopes.

You do not have to sign in again: the tokens are saved under `~/.concretecms-mcp/tokens` (`%USERPROFILE%\.concretecms-mcp\tokens` on Windows), in a separate directory for every site.
See the [Security Guide](security.md) to know how they are stored, and how to encrypt them with `TOKEN_ENCRYPTION_KEY`.
