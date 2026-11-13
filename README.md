[![Build](https://github.com/concrete5-community/concretecms-mcp-server/actions/workflows/build.yml/badge.svg)](https://github.com/concrete5-community/concretecms-mcp-server/actions/workflows/build.yml)

# Concrete CMS MCP Server

Use an AI agent, like Claude Desktop, to work with your [Concrete CMS](https://www.concretecms.org) site: ask it about your pages, files and users, or let it update your content.

AI agents cannot work with a Concrete CMS site by themselves: they need a connector.
This project is that connector: it tells the AI agent what it can do in your site, and it does it on behalf of the agent, using the REST API of Concrete CMS.

You decide what the connector is allowed to do, and it always acts with the permissions of the Concrete CMS user who signed in.

In technical terms, the connector is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server, built with TypeScript.

![Screenshot of a chat with Claude Desktop and a Concrete CMS MCP Server](docs/screenshot.png)

## Installation

There are two ways to use this connector.
In both cases your Concrete CMS site can be anywhere.

### 1. Local configuration only

The connector runs on your computer.

See **[Local configuration](docs/local-setup.md)**.

### 2. Remote server

The connector runs on a server: always on, and shared by several users.

See **[Remote server](docs/remote-server.md)**.

## Usage

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

The update helper needs the scopes of the operations it calls (`getPageById`, `updatePageById`, `updateBlockInPageArea`): usually `pages:read`, `pages:update` and `pages:areas:update_blocks`, but their names may differ in your Concrete CMS version.
When it is hidden, the `list_unavailable_tools` tool tells which scopes are missing.

### Tools and scopes

The AI agent sees only the tools that the scopes of the connector allow to use: the fewer the scopes, the fewer the tools.

The `list_unavailable_tools` tool lists the hidden tools with the scopes they need: when the AI agent cannot do what you ask, it can tell you which scope would make it possible.

See [Choose the scopes](docs/concrete-api.md#3-choose-the-scopes).

### Connection check

The `check_connection` tool verifies that the connector can work with your Concrete CMS site, without signing in.
To use it, ask your AI agent something like "check the connection to my Concrete CMS site".

It checks that:

- the site is reachable
- the pretty URLs and the API are enabled
- the web server passes the `Authorization` header to Concrete CMS
- the API integration accepts the Client ID, the Redirect URI and the scopes of the connector

For every failed check, it tells how to fix it.
It does not check the Client Secret, which is verified when you sign in.

## Documentation

- [Local configuration](docs/local-setup.md): how to run the connector on your computer
- [Remote server](docs/remote-server.md): how to install the connector on a server
- [Set up the Concrete CMS API](docs/concrete-api.md): what to configure in your Concrete CMS site
- [Configuration reference](docs/configuration.md): all the settings of the connector, and when they are needed
- [Connect an AI agent on your computer to a remote connector](docs/local-clients.md): how to use a connector installed on a server from Claude Desktop, ChatGPT, and others
- [Security](docs/security.md): how the tokens and the keys are stored, and how to use the connector safely

For developers:

- [Developer guide: build an application that uses the connector](docs/mcp-client-guide.md)
- [Developer guide: authorize the users from your application](docs/proxied-oauth.md)
- [Try the remote connector on your computer](docs/remote-server-local-test.md)

## ToDos

- Test with other MCP clients.
- Add useful prompts.
- Support another authentication method than OAuth2.

## License

MIT
