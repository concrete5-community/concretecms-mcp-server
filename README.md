[![Build](https://github.com/concrete5-community/concretecms-mcp-server/actions/workflows/build.yml/badge.svg)](https://github.com/concrete5-community/concretecms-mcp-server/actions/workflows/build.yml)

# Concrete CMS MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for [Concrete CMS](https://www.concretecms.org) built with TypeScript.

![Screenshot of a chat with Claude Desktop and a Concrete CMS MCP Server](docs/screenshot.png)

## Installation

### Enable API in Concrete CMS

Since the MCP server uses the Concrete CMS API, you need to enable it in your Concrete CMS installation first.
The [Concrete CMS documentation](https://documentation.concretecms.org/9-x/developers/rest-api/introduction) provides an introduction to the REST API and to its configuration.

When you create the API Integration in Concrete CMS (_System & Settings_ > _API_ > _Integrations_), you have to set the **Redirect URI** to the address where the MCP server receives the OAuth callback.

If you run the MCP server locally (for example with Claude Desktop, or with the prebuilt `.mcpb` extension), the redirect URI is:

```
http://localhost:3000/callback
```

`3000` is the default port: if you customize it with the `HTTP_PORT` setting, adjust the redirect URI accordingly.

If you instead run the MCP server remotely (HTTP transport), the redirect URI is `${PUBLIC_BASE_URL}/oauth/callback` — see the [Remote MCP Server Guide](docs/remote-server.md) for the details.

Take note of the resulting **Client ID** and **Client Secret**: you'll need them when configuring the MCP server (see [Settings](#settings) below).

### Install the MCP Server

#### Via a prebuilt extension

The easiest way to use the Concrete CMS MCP Server with Claude Desktop is to install the prebuilt `.mcpb` extension:

1. Go to the [Releases page](https://github.com/concrete5-community/concretecms-mcp-server/releases) and download the latest `concretecms-mcp-server.mcpb` file.
2. In Claude Desktop, navigate to _Settings_ > _Extensions_.
3. Click _Advanced settings_.
4. In the _Extension Developer_ section, click the _Install Extension_ button and select the downloaded `concretecms-mcp-server.mcpb` file.

Claude Desktop will then ask you for the configuration (Concrete CMS URL, API client ID and secret, and scopes). See [Settings](#settings) below for what to enter.

#### From source

You have to clone this repo and compile it:

```bash
git clone https://github.com/concrete5-community/concretecms-mcp-server.git
cd concretecms-mcp-server
npm ci && npm run build
```

If you use Claude Desktop:

1. Navigate to _Settings_ > _Extensions_
2. Click _Advanced settings_
3. In the _Extension Developer_ section, click _Install Unpacked Extension_
4. Choose the `concretecms-mcp-server` directory

You can also add this MCP server via JSON. For example:

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

This uses the standard `mcpServers` format understood by most MCP clients (Claude Desktop, Cursor, Cline, and others).
It goes in that client's MCP configuration file; if the file already defines other servers, add `concretecms` as another entry under `mcpServers` rather than replacing the whole object.
The exact file and its location depend on the client — check the client's documentation.
For Claude Desktop, open it via _Settings_ > _Developer_ > _Edit Config_ (this creates the file if it does not exist yet), or edit `claude_desktop_config.json` directly (`%APPDATA%\Claude\` on Windows, `~/Library/Application Support/Claude/` on macOS).

Restart the client after saving.

## Usage

### Settings

- Set `CONCRETE_CANONICAL_URL` to the URL of your Concrete CMS installation.
- Set `CONCRETE_API_CLIENT_ID` and `CONCRETE_API_CLIENT_SECRET` to the credentials of a registered API integration.
- Set `CONCRETE_API_SCOPE` to the scopes you want to request. You can find a list of available scopes from `https://your-concrete.example/index.php/dashboard/system/api/scopes`.

After you've configured the MCP server, please restart Claude Desktop. On the first tool call, it will open an authorization window — sign in and authorize the requested scopes.
Now you should be able to get information about your Concrete CMS in a chat. A refresh token will be saved under `~/.concretecms-mcp/tokens/<site>/local.tokens.json` (one directory per `CONCRETE_CANONICAL_URL`), so you don't need to sign in again.

Use separate MCP server entries in Claude Desktop for each Concrete CMS site — each site's tokens are stored independently.

Optionally set `TOKEN_ENCRYPTION_KEY` in the `env` block to encrypt tokens at rest. See the **[Security Guide](docs/security.md)** for details.

For more information about local MCP servers, please refer to the [Claude Desktop documentation](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

### Security

OAuth refresh tokens are stored on disk under `~/.concretecms-mcp/tokens/<site>/` by default (namespaced per `CONCRETE_CANONICAL_URL`). See the **[Security Guide](docs/security.md)** for the threat model, `chmod 600` behavior, encryption, cleanup commands, and remote deployment guidance.

### Run as a remote MCP server

To host the MCP server on a remote Linux server, see the **[Remote MCP Server Guide](docs/remote-server.md)**.

It covers systemd deployment, reverse proxy setup, OAuth configuration, and Docker as an alternative.

To connect a **local desktop client** (ChatGPT Streamable HTTP, Claude Desktop via `mcp-remote`, or another remote MCP client) to that server, see **[Connect Local MCP Clients to a Remote Server](docs/local-clients.md)**.

### For developers: build an MCP client or AI agent

If you are building a programmatic MCP client or AI agent (backend service, web app with chat UI, or Concrete CMS package) that connects to a remote MCP server over HTTP, see the **[MCP Client Developer Guide](docs/mcp-client-guide.md)**.

It covers the HTTP API, per-user OAuth, agent loops, and implementation patterns. For end-user desktop apps talking to a remote server, see [docs/local-clients.md](docs/local-clients.md). For local stdio Claude Desktop, use the section above.

### Use your own OpenAPI specification

The MCP server is loading `openapi.yml` to know which endpoints are available in the Concrete CMS API.
The bundled `openapi.yml` file is generated from the Concrete CMS default installation, but you can also use your own OpenAPI specification.
If you added some Express Objects to your Concrete CMS installation and want to use them in your chat, you can generate a new OpenAPI specification from your installation and use it instead.

1. Check "Include this entity in REST API integrations." in the Express Object settings.
2. Open `https://your-concrete.example/index.php/ccm/system/api/openapi.json` in your browser, and copy the JSON output.
3. Replace the `openapi.yml` file in the `concretecms-mcp-server` directory with your own OpenAPI specification.

## Features

This MCP server is depended on the Concrete CMS API, so it supports all features that are available through the API.
For example:

- Get information about your Concrete CMS installation.
- Get content from your Concrete CMS installation.
- Update content in your Concrete CMS installation.
- Upload files to your Concrete CMS installation.
- Get a list of users in your Concrete CMS installation.
- And more!

You can find a list of all available endpoints in [Concrete CMS REST API - Endpoints](https://documentation.concretecms.org/9-x/developers/rest-api/concrete-cms-rest-api-endpoints)

### High-level page tools

In addition to OpenAPI-generated tools, the server exposes helpers for common page workflows:

- `get_page_content` — read a page as a document (`html`, `html_raw`, and plain `text`) via `includes=content`
- `update_page_content` — create an editable page version, remap block IDs, then update specific blocks (PUT page + PUT area)

Prefer these when reviewing or editing page copy. Use the raw OpenAPI tools (`getPageById`, `updateBlockInPageArea`, etc.) for lower-level control.

Required OAuth scopes for the update helper: `pages:read`, `pages:update`, `pages:areas:update_blocks`.

## ToDos

- Test with other MCP clients.
- Add useful prompts.
- Support another authentication method than OAuth2.

## License

MIT
