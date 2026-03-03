# AAI Gateway

A Model Context Protocol (MCP) server that bridges AI agents to AAI-enabled desktop and web applications. Uses a **guide-based discovery model** that minimizes context explosion while enabling progressive app interaction.

Reference implementation of the [AAI Protocol](https://github.com/gybob/aai-protocol).

### Key Features

- **Guide-based discovery**. Apps expose operation guides on demand, keeping context minimal (`O(apps + 2)` instead of `O(apps × tools)`).
- **Multi-language support**. App names support multiple languages for better user intent matching.
- **Native security**. Leverages OS-level consent (TCC, UAC, Polkit) and secure storage (Keychain, Credential Manager).
- **Cross-platform**. Supports macOS today, Linux and Windows planned.
- **Web app support**. Built-in descriptors for popular web apps (Notion, Yuque, Feishu) with multiple auth types.

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
<summary>OpenCode</summary>

Add to `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "aai-gateway": {
      "type": "local",
      "command": ["npx", "aai-gateway"],
      "enabled": true
    }
  }
}
```

With `--dev` flag:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "aai-gateway": {
      "type": "local",
      "command": ["npx", "aai-gateway", "--dev"],
      "enabled": true
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

AAI Gateway exposes **tools only** (no resources). This simplifies the agent workflow and ensures all capabilities are discoverable via `tools/list`.

#### `tools/list`

Returns all discovered desktop apps plus universal tools:

```json
{
  "tools": [
    {
      "name": "app:com.apple.reminders",
      "description": "【Reminders|提醒事项|Rappels】macOS reminders app. Aliases: todo, 待办. Call to get guide.",
      "inputSchema": { "type": "object", "properties": {} }
    },
    {
      "name": "web:discover",
      "description": "Discover web app guide. Use when user mentions a web service not in list. Supports URL/domain/name.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "url": { "type": "string", "description": "Web app URL, domain, or name" }
        },
        "required": ["url"]
      }
    },
    {
      "name": "aai:exec",
      "description": "Execute app operation. Use after reading the operation guide.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "app": { "type": "string", "description": "App ID or URL" },
          "tool": { "type": "string", "description": "Operation name" },
          "args": { "type": "object", "description": "Operation parameters" }
        },
        "required": ["app", "tool"]
      }
    }
  ]
}
```

**Context Efficiency**: Only `O(apps + 2)` entries instead of `O(apps × tools)`.

#### App Tool (`app:*`)

Call `app:<app-id>` to get an operation guide:

```json
{
  "name": "app:com.apple.reminders",
  "arguments": {}
}
```

Returns a guide with available operations, parameters, and usage examples.

#### Web Discovery (`web:discover`)

Discover web apps by URL, domain, or name:

```json
{
  "name": "web:discover",
  "arguments": { "url": "notion.com" }
}
```

Returns the web app's operation guide.

#### Tool Execution (`aai:exec`)

Execute operations after reading the guide:

```json
{
  "name": "aai:exec",
  "arguments": {
    "app": "com.apple.reminders",
    "tool": "create_reminder",
    "args": {
      "title": "Submit report",
      "due": "2024-12-31 15:00"
    }
  }
}
```

**Execution flow:**

1. Resolve app descriptor (local registry, built-in registry, or web fetch)
2. Show native consent dialog — user approves/denies (remembered per tool or globally)
3. **Auth**: 
   - Desktop apps: Native IPC
   - Web apps: OAuth 2.1 PKCE, API Key, App Credential, or Cookie
4. Execute and return result

### Built-in Web Apps

The gateway includes built-in descriptors for popular web apps:

| App | Auth Type | Description |
|-----|-----------|-------------|
| Yuque (语雀) | API Key | Knowledge management platform |
| Notion | API Key | All-in-one workspace |
| Feishu (飞书) | App Credential | Enterprise collaboration |

### Web App Authentication

The gateway supports multiple authentication methods for web apps:

| Auth Type | Use Case | User Flow |
|-----------|----------|-----------|
| `apikey` | Static API tokens (never expire) | Dialog prompts for token, stored securely |
| `app_credential` | App ID + Secret (auto-refresh) | Dialog prompts for credentials, token fetched automatically |
| `oauth2` | OAuth 2.0 with PKCE | Browser-based authorization flow |
| `cookie` | No official API | Manual cookie extraction from browser |

### Agent Workflow Example

```
User: "帮我在提醒事项里创建一个提醒"

Agent:
1. tools/list → Sees "【Reminders|提醒事项】"
2. Match "提醒事项" → app:com.apple.reminders
3. tools/call("app:com.apple.reminders", {}) → Gets operation guide
4. tools/call("aai:exec", {app, tool, args}) → Executes operation
5. Returns result to user
```

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

**Multi-language names** (pipe-separated):

```json
{
  "app": {
    "id": "com.example.reminders",
    "name": "Reminders|提醒事项|Rappels|Erinnerungen",
    "description": "Task and reminder management",
    "aliases": ["todo", "task", "待办"]
  }
}
```

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

Apache-2.0
