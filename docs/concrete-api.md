# Set up the Concrete CMS API

The connector uses the REST API of Concrete CMS.
You have to enable it, and to create an API integration, in every Concrete CMS site you want to connect to.

## 1. Enable the API

In the Concrete CMS dashboard, go to _System & Settings_ > _API_ and enable the API.

See the [Concrete CMS documentation](https://documentation.concretecms.org/9-x/developers/rest-api/introduction) for an introduction to the REST API and to its configuration.

## 2. Create an API integration

Go to _System & Settings_ > _API_ > _Integrations_ and add a new integration.

The **Redirect URI** is the address where the connector receives the result of the sign-in.
It depends on where the connector runs:

| Where the connector runs                                 | Redirect URI                        |
| -------------------------------------------------------- | ----------------------------------- |
| On your computer ([Local configuration](local-setup.md)) | `http://localhost:3000/callback`    |
| On a server ([Remote server](remote-server.md))          | `${PUBLIC_BASE_URL}/oauth/callback` |

The Redirect URI must match exactly, port included.
`3000` is the default port: if you change it with the `HTTP_PORT` setting, change the Redirect URI accordingly.

Take note of the **Client ID** and of the **Client Secret** of the integration: you need them to configure the connector.
Copy the Client Secret right away: Concrete CMS stores it hashed, and cannot show it again.

## 3. Choose the scopes

The scopes define what the connector is allowed to do in the site.
You can see the scopes available in your site at `https://your-concrete.example/index.php/dashboard/system/api/scopes`.

List the scopes you want in the `CONCRETE_API_SCOPE` setting, separated by spaces.
For example:

```
account:read system:info:read pages:read
```

Please note that:

- `account:read` is required when the connector runs on a server.
- The AI agent sees only the tools that the scopes allow to use: with fewer scopes it has fewer tools to choose from, and it works with less context. It can still list the hidden tools, to tell you which scope it would need for a request it cannot fulfill.
- The available scopes depend on the version of Concrete CMS: asking for a scope that does not exist in your site makes the sign-in fail with an `invalid_scope` error.
- `openid` is ignored, because the connector does not use it.
