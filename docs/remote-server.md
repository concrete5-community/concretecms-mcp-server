# Remote server

The connector runs on a web server, and the AI agents reach it over the network.

Choose this setup when:

- several people must use the same connector: you configure it once, on the server
- the AI agent does not run on your computer (for example an online AI service, a web application, or a Concrete CMS package), so it cannot start a program on it
- you want the credentials of Concrete CMS to stay on the server, instead of on the computer of every user
- you want to connect to more than one Concrete CMS site (see [Several Concrete CMS sites](#several-concrete-cms-sites))

If you are the only user, and your AI agent runs on your computer, the [Local configuration](local-setup.md) may be simpler.

## How it works

- The connector runs on a web server, and has its own address (for example `https://mcp.example.com`).
- The address must be reachable by the AI agents and by the browsers of the people using them: it can be on the internet, or only inside your local network.
- The AI agents connect to that address, using a key that you choose.
- Every person signs in to Concrete CMS once, to authorize the connector to act on their behalf.

## What you need

- A web server where you can install and run programs, with [Git](https://git-scm.com/install) and [Node.js](https://nodejs.org/en/download) 22 or later (the examples in this page are for Linux).
- An address for the connector. It should use HTTPS, because the key and the data of your site travel over it.
- An administrator account in your Concrete CMS site, to set up its API.

If you only want to try the connector before installing it on a server, see [Try the remote connector on your computer](remote-server-local-test.md).

## Installation

### 1. Choose the address

The connector needs its own address.
You have two options:

- a dedicated subdomain: it is the simplest option
- the same domain as your Concrete CMS site, with a path prefix that keeps the two apart

|                               | Dedicated subdomain                      | Same domain, with a prefix                       |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------ |
| `PUBLIC_BASE_URL`             | `https://mcp.example.com`                | `https://www.example.com`                        |
| `PATH_PREFIX`                 | Empty or not set                         | `/ccm-mcp`                                       |
| Address for the AI agents     | `https://mcp.example.com/mcp`            | `https://www.example.com/ccm-mcp/mcp`            |
| Redirect URI for Concrete CMS | `https://mcp.example.com/oauth/callback` | `https://www.example.com/ccm-mcp/oauth/callback` |

`PUBLIC_BASE_URL` and `PATH_PREFIX` are two of the settings of the connector: you will set them in step 4.
(You can fully customize the paths above: see the [Paths](configuration.md#paths) section of the Configuration reference.)

### 2. Set up the Concrete CMS API

[Set up the Concrete CMS API](concrete-api.md) in your site, using the Redirect URI of the address you chose in step 1.

The scopes you choose must include `account:read`: the connector needs it to know which Concrete CMS user has signed in.

### 3. Install the connector

Check that Git and Node.js are installed on the server:

```bash
git --version
node --version
npm --version
```

The connector should run as a dedicated user, with no other permissions on the server.
Create it (the examples in this page call it `mcp`):

```bash
sudo useradd --system --user-group --create-home --home-dir /var/lib/concretecms-mcp --shell /usr/sbin/nologin mcp
```

Then download and build the connector, in a directory of your choice (for example `/opt/concretecms-mcp`):

```bash
sudo mkdir -p /opt/concretecms-mcp
sudo chown mcp:mcp /opt/concretecms-mcp
cd /opt/concretecms-mcp
sudo -u mcp git clone https://github.com/concrete5-community/concretecms-mcp-server.git .
sudo -u mcp npm ci
sudo -u mcp npm run build
```

### 4. Configure the connector

Generate two secrets:

```bash
# The key used to encrypt the saved tokens (TOKEN_ENCRYPTION_KEY)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# The key the AI agents must use to connect (MCP_API_KEY)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Create the file with the settings, accessible only by the user that runs the connector, then edit it (the examples use `nano`, but you can use your preferred editor):

```bash
sudo touch /etc/concretecms-mcp.env
sudo chown mcp:mcp /etc/concretecms-mcp.env
sudo chmod 0600 /etc/concretecms-mcp.env
sudo nano /etc/concretecms-mcp.env
```

For example:

```bash
PUBLIC_BASE_URL=https://mcp.example.com
CONCRETE_CANONICAL_URL=https://www.example.com
CONCRETE_API_CLIENT_ID=YOUR_API_CLIENT_ID
CONCRETE_API_CLIENT_SECRET=YOUR_API_CLIENT_SECRET
CONCRETE_API_SCOPE=account:read system:info:read
HTTP_PORT=3000
TOKEN_ENCRYPTION_KEY=your-base64-key
MCP_API_KEY=your-mcp-api-key
TOKEN_DIR=/var/lib/concretecms-mcp/tokens
```

Create the directory where the tokens are saved:

```bash
sudo mkdir -p /var/lib/concretecms-mcp/tokens
sudo chown mcp:mcp /var/lib/concretecms-mcp/tokens
sudo chmod 700 /var/lib/concretecms-mcp/tokens
```

The settings a remote connector always needs are:

- the four `CONCRETE_*` settings of your Concrete CMS site
- `TRANSPORT_TYPE=http` (in these examples it is set in the service, see step 5)
- `PUBLIC_BASE_URL`: the address of the connector
- `TOKEN_ENCRYPTION_KEY`: the key used to encrypt the saved tokens
- `MCP_API_KEY` (or `MCP_API_KEYS`): the key the AI agents must use to connect

See the [Configuration reference](configuration.md) for all the settings and their defaults.

### 5. Run the connector as a service

Running the connector as a systemd service keeps it always on, and restarts it when needed.

Create the service:

```bash
sudo nano /etc/systemd/system/concretecms-mcp.service
```

```ini
[Unit]
Description=Concrete CMS MCP Server
After=network.target

[Service]
Type=simple
User=mcp
Group=mcp
WorkingDirectory=/opt/concretecms-mcp
EnvironmentFile=/etc/concretecms-mcp.env
Environment=TRANSPORT_TYPE=http
Environment=HTTP_HOST=0.0.0.0
Environment=HTTP_PORT=3000
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Replace the paths with the ones of your server.
You can find the path of Node.js with `which node`.

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable concretecms-mcp
sudo systemctl start concretecms-mcp
sudo systemctl status concretecms-mcp
```

Other useful commands:

```bash
# Restart the connector (for example after changing its settings)
sudo systemctl restart concretecms-mcp

# Follow the log of the connector
sudo journalctl -u concretecms-mcp -f

# Clear the "failed" state of the service, after fixing a problem
sudo systemctl reset-failed concretecms-mcp
```

To update the connector to a newer version:

```bash
cd /opt/concretecms-mcp
sudo -u mcp git pull
sudo -u mcp npm ci
sudo -u mcp npm run build
sudo systemctl restart concretecms-mcp
```

### 6. Make the connector reachable

The connector listens on port 3000 of the server.
To make it reachable at the address you chose in step 1, configure the web server to forward the requests to it (that is, as a reverse proxy).

The examples below are for nginx, but you can do the same with Apache, Caddy, or other web servers.

As an additional protection, you can limit how often the sign-in addresses can be called.
Add this line to the `http` section of the nginx configuration: it defines a limit of 10 requests per minute for every IP address.

```nginx
limit_req_zone $binary_remote_addr zone=mcp_oauth:10m rate=10r/m;
```

The `limit_req` lines in the first example below apply it (remove them if you do not add this line).

#### Dedicated subdomain

```nginx
location /mcp {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
}

location = /oauth/start {
    limit_req zone=mcp_oauth burst=5 nodelay;
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /oauth/callback {
    limit_req zone=mcp_oauth burst=5 nodelay;
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /oauth/status {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
}

location = /oauth/revoke {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
}

location = /health {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
}
```

#### Same domain, with `PATH_PREFIX=/ccm-mcp`

```nginx
location /ccm-mcp/mcp {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_buffering off;
}

location /ccm-mcp/oauth/ {
    proxy_pass http://127.0.0.1:3000;
}

location /ccm-mcp/health {
    proxy_pass http://127.0.0.1:3000;
}
```

Do not forward the whole `/oauth/` path to the connector: Concrete CMS uses `/oauth/2.0/*` for its own sign-in.

Reload the web server after changing its configuration.

### 7. Check that it works

```bash
curl https://mcp.example.com/health
```

The answer must be:

```json
{ "status": "healthy" }
```

## Docker (alternative)

If you prefer containers, you can use Docker instead of the steps 3, 4 and 5: you do not need Node.js, the dedicated user, or the service.
You still need all the other steps.

Download the source code of the connector, and create the file with the settings:

```bash
git clone https://github.com/concrete5-community/concretecms-mcp-server.git
cd concretecms-mcp-server
cp .env.example .env
chmod 600 .env
```

Edit `.env`, setting at least:

- the four `CONCRETE_*` settings of your Concrete CMS site
- `PUBLIC_BASE_URL`: the address of the connector
- `TOKEN_ENCRYPTION_KEY`: generate it with `openssl rand -base64 32`
- `MCP_API_KEY`: generate it with `openssl rand -hex 32`

Then start the connector:

```bash
docker compose up -d --build
```

Please note that:

- `TRANSPORT_TYPE=http` is already set in `docker-compose.yml`.
- The tokens are saved in the `mcp-tokens` Docker volume.
- The connector is restarted automatically if it stops.
- Only the settings listed in `docker-compose.yml` are passed to the connector: to use other ones, add them to that file.

## Authorize the users

Every person must authorize the connector once, by signing in to Concrete CMS.
After that, the connector acts in Concrete CMS with the permissions of that person.

In a local configuration the connector opens the browser for you.
A remote connector cannot do that: someone who knows the key must start the sign-in with a command, and the person to authorize completes it in a browser.

You need:

- the ID of the Concrete CMS user (`42` in these examples)
- the key for the AI agents, that is the `MCP_API_KEY` you generated in step 4 (`$MCP_API_KEY` in these examples)

To authorize a user:

```bash
curl -s -D - -o /dev/null -H "Authorization: Bearer $MCP_API_KEY" \
  "https://mcp.example.com/oauth/start?user_id=42"
```

The answer contains a `Location` line with an address.
The person to authorize must open it in a browser within 10 minutes, sign in to Concrete CMS, and approve the scopes.
If another sign-in is already in progress for that user, the answer is a `409` error.

To check if a user is authorized:

```bash
curl -H "Authorization: Bearer $MCP_API_KEY" \
  "https://mcp.example.com/oauth/status?user_id=42"
```

```json
{ "userId": 42, "authenticated": true, "expiresAt": 1710000000000 }
```

To revoke the authorization of a user:

```bash
curl -X POST -H "Authorization: Bearer $MCP_API_KEY" \
  "https://mcp.example.com/oauth/revoke?user_id=42"
```

The tokens are saved on the server, in a subdirectory of `TOKEN_DIR`.

If you are building an application that authorizes the users for them, see [Proxied OAuth](proxied-oauth.md).

## Personal keys (optional)

With `MCP_API_KEY` all the people share the same key, and every AI agent must also say which Concrete CMS user it works for.

As an alternative, you can give every person a different key, tied to the Concrete CMS user of that person.
In the settings of the connector, replace `MCP_API_KEY` with `MCP_API_KEYS`, listing every key with the ID of its user:

```bash
MCP_API_KEYS='{"key-of-the-user-42":42,"key-of-the-user-57":57}'
```

Use a different, hard to guess key for every person (you can generate them like in step 4), and restart the connector after changing the settings.

Please note that:

- when `MCP_API_KEYS` is set, `MCP_API_KEY` is ignored
- a key with `null` instead of a user ID is not tied to a person: it works like `MCP_API_KEY`
- every person must still be authorized, as described above

See the [Security Guide](security.md#client-authentication) for more details.

## Connect the AI agents

Every AI agent needs:

- the address for the AI agents (see step 1), for example `https://mcp.example.com/mcp`
- the key for the AI agents: the `MCP_API_KEY` you generated in step 4, or a personal key
- the ID of the Concrete CMS user it works for (not needed with a personal key)

How to configure them depends on the AI agent:

- AI agents running on a computer (for example Claude Desktop or ChatGPT): see [Connect an AI agent on your computer to a remote connector](local-clients.md)
- your own application or AI agent: see the [Developer guide](mcp-client-guide.md)

For developers: the connector uses the [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) transport of MCP, and every request must include these headers:

```
Authorization: Bearer <MCP_API_KEY>
X-Concrete-User-Id: <cms_user_id>
```

## Several Concrete CMS sites

One connector works with one Concrete CMS site.
To connect to several sites, run one connector per site.

The connectors can share the same server and the same copy of the code: what changes is the configuration.
For every site you need:

- its own API integration in Concrete CMS (see [Set up the Concrete CMS API](concrete-api.md))
- its own file with the settings, with the `CONCRETE_*` settings of that site
- its own `HTTP_PORT`, if the connectors run on the same server: it is the internal port the web server forwards the requests to, and it is not part of the address (change it in the service too, because the example in step 5 sets it there)
- its own address: a dedicated subdomain, or a different `PATH_PREFIX` on the same domain
- its own service, and its own rules in the configuration of the web server

For example:

|                               | Site A                                     | Site B                                     |
| ----------------------------- | ------------------------------------------ | ------------------------------------------ |
| `CONCRETE_CANONICAL_URL`      | `https://site-a.example`                   | `https://site-b.example`                   |
| `PUBLIC_BASE_URL`             | `https://mcp-a.example.com`                | `https://mcp-b.example.com`                |
| `HTTP_PORT`                   | `3000`                                     | `3001`                                     |
| The web server forwards to    | `http://127.0.0.1:3000`                    | `http://127.0.0.1:3001`                    |
| File with the settings        | `/etc/concretecms-mcp-a.env`               | `/etc/concretecms-mcp-b.env`               |
| Service                       | `concretecms-mcp-a`                        | `concretecms-mcp-b`                        |
| Redirect URI for Concrete CMS | `https://mcp-a.example.com/oauth/callback` | `https://mcp-b.example.com/oauth/callback` |

The connectors can use the same `TOKEN_DIR`: the tokens of every site are saved in a separate subdirectory.

The AI agents connect to every connector separately: configure one connection per site.

## Security

See the [Security Guide](security.md) to know how the tokens are stored and encrypted, who is trusted, and how to revoke the access.
