# Connect an AI agent on your computer to a remote connector

This page explains how to configure an AI agent that runs on your computer (for example Claude Desktop or ChatGPT) to use a connector installed on a server.
It is for the people who use the connector: to install it on a server, see [Remote server](remote-server.md).

If the connector should run on your computer too, see [Local configuration](local-setup.md).
If you are building your own application, see the [Developer guide](mcp-client-guide.md).

## What you need

Ask who manages the connector for:

- the address of the connector for the AI agents, for example `https://mcp.example.com/mcp`
- the key to use
- your user ID in Concrete CMS (you do not need it if you received a personal key)

You must also be authorized to use the connector: see [Authorize the users](remote-server.md#authorize-the-users).
Until then your AI agent can connect, but its requests fail.

## Claude Desktop

The JSON configuration file of Claude Desktop can only start programs on your computer.
To reach a remote connector it needs the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge, which requires [Node.js](https://nodejs.org/en/download) on your computer.

Open the JSON configuration file (see [how to find it](local-setup.md#find-the-json-configuration-file-of-your-ai-agent)) and add this entry:

```json
{
  "mcpServers": {
    "concretecms-remote": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://mcp.example.com/mcp",
        "--header",
        "Authorization: Bearer ${MCP_API_KEY}",
        "--header",
        "X-Concrete-User-Id: 1"
      ],
      "env": {
        "MCP_API_KEY": "your-key"
      }
    }
  }
}
```

Replace the address, the key (`your-key`) and the user ID (`1`).
If you received a personal key, remove the two lines of the `X-Concrete-User-Id` header.

Restart Claude Desktop after saving the file.

## ChatGPT

These steps are for the desktop application of ChatGPT.

1. Open **Settings → Plugins → MCPs** (the name of this page may be different in your version).
2. Choose **Connect to a custom MCP**.
3. Fill in the fields:

   | Field | Value                           |
   | ----- | ------------------------------- |
   | Name  | Concrete CMS (or any other)     |
   | Type  | **Streamable HTTP** (not STDIO) |
   | URL   | `https://mcp.example.com/mcp`   |

4. Set the key as **Bearer token env var** (for example `MCP_BEARER_TOKEN`), and save the key in that environment variable.
   Do not add an `Authorization` header by hand too: with both, the connection may fail.
5. Add the header `X-Concrete-User-Id` with your user ID (you can skip this if you received a personal key).
6. Save, enable the connector in a chat, and ask something about your Concrete CMS site (for example its system information, or the list of its pages).

## Other AI agents

Any AI agent that supports remote MCP servers with the Streamable HTTP transport can use the connector.
Configure it with:

- the address of the connector, for example `https://mcp.example.com/mcp`
- the header `Authorization: Bearer <key>`
- the header `X-Concrete-User-Id: <your user ID>` (not needed with a personal key)

## Troubleshooting

| Problem                                        | Likely cause                                       | What to do                                                                                              |
| ---------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| The AI agent cannot connect                    | Wrong address, or connector not reachable          | Check the address (it usually ends with `/mcp`), and that the connector is reachable from your computer |
| `401 Unauthorized`                             | Missing or wrong key                               | Check the key                                                                                           |
| `400`, missing user context                    | Missing user ID, and the key is not a personal one | Add the `X-Concrete-User-Id` header, or ask for a personal key                                          |
| It connects, but the requests fail             | You are not authorized yet                         | Ask to be authorized: see [Authorize the users](remote-server.md#authorize-the-users)                   |
| ChatGPT connects only sometimes, or not at all | The key is set in two places                       | Use either the Bearer token env var or the `Authorization` header, not both                             |
| `404` error                                    | The address lacks a part of the path               | Ask for the complete address: it may contain a prefix, like `https://cms.example.com/ccm-mcp/mcp`       |

## Security recommendations

- Ask for a personal key, instead of sharing the same key with other people.
- Do not write the key in files or screenshots that you share.
- When you stop using the connector from a shared computer, ask to revoke your authorization.
