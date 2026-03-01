# AAI Gateway

A Model Context Protocol (MCP) server that bridges AI agents to AAI-enabled desktop and web applications. Discovers apps via standard `aai.json` descriptors, invokes them through native IPC or OAuth 2.1 PKCE HTTP, with native consent dialogs and secure credential storage.

Reference implementation of the [AAI Protocol](https://github.com/gybob/aai-protocol).

### Key Features

- **Zero intrusion**. Uses existing OS automation (AppleScript, COM, DBus) — no app modification required.
- **Progressive discovery**. Apps discovered on-demand via MCP resources, avoiding context explosion.
- **Native security**. Leverages OS-level consent (TCC, UAC, Polkit) and secure storage (Keychain, Credential Manager).
- **Cross-platform**. Supports macOS today, Linux and Windows planned.

### Requirements

- Node.js 18 or newer
- macOS (Linux and Windows support planned)
- VS Code, Cursor, Windsurf, Claude Desktop, or any MCP client

### Getting started

Add AAI Gateway to your MCP client configuration.

**Standard config:**

```json
{
  "mcpServers": {
    "aai-gateway": {
      "command": "npx",
      "args": ["aai-gateway"]
    }
  }
}
```

<details>
<summary>Claude Code</summary>

```bash
claude mcp add aai-gateway npx aai-gateway
```

</details>

<details>
<summary>Claude Desktop</summary>

Follow the MCP install [guide](https://modelcontextprotocol.io/quickstart/user), use the standard config above. Config file location: `~/Library/Application Support/Claude/claude_desktop_config.json`

</details>

<details>
<summary>Copilot / VS Code</summary>

```bash
code --add-mcp '{"name":"aai-gateway","command":"npx","args":["aai-gateway"]}'
```

Or add manually to your MCP settings.

</details>

<details>
<summary>Cursor</summary>

Go to `Cursor Settings` -> `MCP` -> `Add new MCP Server`. Name: `aai-gateway`, type: `command`, command: `npx aai-gateway`.

</details>

<details>
<summary>Windsurf</summary>

Add to your Windsurf MCP config:

```json
{
  "mcpServers": {
    "aai-gateway": {
      "command": "npx",
      "args": ["aai-gateway"]
    }
  }
}
```

</details>

### Configuration

AAI Gateway supports the following command-line arguments:

| Option      | Description                                                                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dev`     | Enable development mode. Scans Xcode build directories for apps in development: `~/Library/Developer/Xcode/DerivedData/*/Build/Products/{Debug,Release}/*.app` |
| `--scan`    | Scan for AAI-enabled apps and exit (for debugging)                                                                                                             |
| `--version` | Show version                                                                                                                                                   |
| `--help`    | Show help                                                                                                                                                      |

**Development mode example:**

```json
{
  "mcpServers": {
    "aai-gateway": {
      "command": "npx",
      "args": ["aai-gateway", "--dev"]
    }
  }
}
```

Use `--dev` when developing AAI-enabled applications in Xcode to discover apps before they're installed to `/Applications`.

### MCP Interface

AAI Gateway exposes three MCP primitives. Agents discover tools progressively through resources — no `tools/list` — to avoid context explosion.

#### `resources/list`

Returns all AAI-enabled apps discovered on the current machine.

```json
{
  "resources": [
    {
      "uri": "app:com.acme.crm",
      "name": "Acme CRM",
      "description": "Customer relationship management"
    },
    {
      "uri": "app:com.acme.invoice",
      "name": "Acme Invoice",
      "description": "Invoice and billing management"
    }
  ]
}
```

#### `resources/read`

Accepts two URI types:

- **`app:<bundle-id>`** — reads the descriptor for a locally installed desktop app
- **`https://<domain>`** — fetches `/.well-known/aai.json` from a web service (cached 24h)

Returns the full `aai.json` descriptor including the app's tool list and schemas.

#### `tools/call`

Tool name format: `<app-id>:<tool-name>`

```json
{
  "name": "com.acme.crm:create_contact",
  "arguments": { "name": "Alice", "email": "alice@example.com", "company": "Example Inc." }
}
```

**Execution flow:**

1. Resolve app descriptor (local registry or web fetch)
2. Validate tool and arguments
3. Show native consent dialog — user approves/denies (remembered per tool or globally)
4. Execute: desktop apps via native IPC, web apps via HTTP with OAuth 2.1 PKCE token
5. Return result

### Platform Support

| Platform | Discovery                 | IPC Executor             | Consent Dialog    | Secure Storage        |
| -------- | ------------------------- | ------------------------ | ----------------- | --------------------- |
| macOS    | ✅                        | ✅ Apple Events          | ✅ osascript      | ✅ Keychain           |
| Linux    | 🔜                        | 🔜 DBus                  | 🔜 zenity/kdialog | 🔜 libsecret          |
| Windows  | 🔜                        | 🔜 COM                   | 🔜 PowerShell     | 🔜 Credential Manager |
| Web      | ✅ `.well-known/aai.json` | ✅ HTTP + OAuth 2.1 PKCE | —                 | ✅ (via platform)     |

### For App Developers

To make your app discoverable by AAI Gateway, ship an `aai.json` descriptor:

**macOS:** `<App>.app/Contents/Resources/aai.json`

**Web:** `https://<your-domain>/.well-known/aai.json`

See the [AAI Protocol Spec](https://github.com/gybob/aai-protocol) for the full `aai.json` schema.

### Debugging

```bash
# List discovered AAI-enabled apps
npx aai-gateway --scan

# Include Xcode build products
npx aai-gateway --scan --dev
```

### Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

### Links

- [AAI Protocol Spec](https://github.com/gybob/aai-protocol)

### License

MIT
