# Connect an AI agent on your computer to a remote connector

This page explains how to configure an AI agent that runs on your computer (for example Claude Desktop or ChatGPT) to use a connector installed on a server.
It is for the people who use the connector: to install it on a server, see [Remote server](remote-server.md).

If the connector should run on your computer too, see [Local configuration](local-setup.md).
If you are building your own application, see the [Developer guide](mcp-client-guide.md).

## What you need

Ask who manages the connector for:

- the address of the connector for the AI agents, for example `https://mcp.example.com/mcp`
- the key for the AI agents: the one shared by all the users (the `MCP_API_KEY` of the connector), or your personal key
- your user ID in Concrete CMS (you do not need it if you received a personal key)

If you manage the connector yourself, see [Connect the AI agents](remote-server.md#connect-the-ai-agents).

You must also be authorized to use the connector: see [Authorize the users](remote-server.md#authorize-the-users).
Until then your AI agent can connect, but its requests fail.

## Claude

You can connect Claude in two ways: with a custom connector, or with the JSON configuration file of Claude Desktop.

### Custom connector

A custom connector is saved in your Claude account, and it needs nothing installed on your computer.

Claude reaches it from the servers of Anthropic, not from your computer: if the access to the connector is restricted, who manages it must [let them in](remote-server.md#let-claude-reach-the-connector).

1. Open **Settings → Customize → Connectors** (the names may be different in your version).
2. Click **Add**, then **Add custom connector**.
3. Fill in the name (for example the one of your site) and the address of the connector, for example `https://mcp.example.com/mcp`.
   Claude checks the connector, then it shows its settings.
4. Under **Authentication**, choose **No sign-in**.
   Claude suggests **Sign in now**, but the connector uses a key instead.
5. Under **Request headers**, click **Add header** and add these headers, choosing their names from the list:

   | Name            | Value                                                |
   | --------------- | ---------------------------------------------------- |
   | `authorization` | `Bearer your-key`                                    |
   | `x-account-id`  | your user ID (not needed if you have a personal key) |

   Replace `your-key` with the key for the AI agents, keeping the word `Bearer` and the space before the key.

   Claude accepts only the header names of its list: this is why your user ID goes in `x-account-id` instead of `X-Concrete-User-Id`.

6. Click **Add**.

Claude saves the key in your account and it never shows it again: keep a copy of it.

### JSON configuration file

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

If your AI agent cannot send headers with custom names, call the second header `X-Account-Id`: the connector accepts both names.

## Troubleshooting

| Problem                                        | Likely cause                                       | What to do                                                                                              |
| ---------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| The AI agent cannot connect                    | Wrong address, or connector not reachable          | Check the address (it usually ends with `/mcp`), and that the connector is reachable from your computer |
| Claude cannot check the custom connector       | The servers of Anthropic cannot reach it           | Ask who manages the connector to [let them in](remote-server.md#let-claude-reach-the-connector)         |
| `401 Unauthorized`                             | Missing or wrong key                               | Check the key                                                                                           |
| `400`, missing user context                    | Missing user ID, and the key is not a personal one | Add the `X-Concrete-User-Id` header, or ask for a personal key                                          |
| It connects, but the requests fail             | You are not authorized yet                         | Ask to be authorized: see [Authorize the users](remote-server.md#authorize-the-users)                   |
| ChatGPT connects only sometimes, or not at all | The key is set in two places                       | Use either the Bearer token env var or the `Authorization` header, not both                             |
| `404` error                                    | The address lacks a part of the path               | Ask for the complete address: it may contain a prefix, like `https://cms.example.com/ccm-mcp/mcp`       |

## Security recommendations

- Ask for a personal key, instead of sharing the same key with other people.
- Do not write the key in files or screenshots that you share.
- When you stop using the connector from a shared computer, ask to revoke your authorization.
