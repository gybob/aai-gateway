# AAI Gateway

**One MCP to access all desktop and web applications.**

A Model Context Protocol (MCP) server that bridges AI agents to desktop and web applications through the [AAI Protocol](https://github.com/gybob/aai-protocol).

## The Innovation: Progressive Disclosure

**Problem**: Traditional MCP servers load all tools upfront, causing context explosion.

```
Traditional: tools/list returns 1000+ tools from 50 apps
→ Context window blown
→ Agent confused
→ Performance degraded
```

**Our Solution**: Guide-based progressive disclosure.

```
AAI Gateway: tools/list returns 50 app entries + 2 universal tools
→ O(apps + 2) instead of O(apps × tools)
→ Agent calls app:<id> to get tool guide on-demand
→ Context stays minimal
```

This innovation enables agents to discover and use thousands of tools without overwhelming the context window.

## How It Works

┌─────────────────────────────────────────────────────────────────┐
│                    Desktop App Workflow                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. tools/list                                                   │
│     └─→ Returns: ["app:com.apple.mail", "app:com.apple.calendar",
│                   "web:discover", "aai:exec"]                    │
│         Only 4 entries! (Not 50+ tools)                          │
│                                                                  │
│  2. User: "Send an email to John"                               │
│     └─→ Agent matches "email" → calls app:com.apple.mail         │
│                                                                  │
│  3. tools/call("app:com.apple.mail")                            │
│     └─→ Returns: Operation guide with available tools            │
│         - sendEmail(to, subject, body)                           │
│         - readInbox(folder, limit)                               │
│         - ...                                                    │
│                                                                  │
│  4. tools/call("aai:exec", {app, tool: "sendEmail", args})       │
│     └─→ Executes operation                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      Web App Workflow                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. User: "Search my Notion workspace"                          │
│     └─→ Agent matches "Notion" → calls web:discover              │
│                                                                  │
│  2. tools/call("web:discover", {url: "notion.com"})              │
│     └─→ Returns: Operation guide with available tools            │
│         - listDatabases(), queryDatabase(id), search(query)      │
│         - ...                                                    │
│                                                                  │
│  3. tools/call("aai:exec", {app: "notion.com", tool, args})      │
│     └─→ Executes operation                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Context Efficiency**:

- Traditional: 50 apps × 20 tools = 1000 context entries
- AAI Gateway: 50 apps + 2 = 52 context entries

## Features

- **Progressive Disclosure**. Apps expose operation guides on-demand, preventing context explosion.
- **Multi-language Support**. App names support multiple languages for better intent matching.
- **Native Security**. Leverages OS-level consent (TCC, UAC, Polkit) and secure storage (Keychain).
- **Cross-platform**. macOS today, Linux and Windows planned.

## Supported Apps

### Desktop Apps (AAI-enabled)

Apps shipping `aai.json` descriptor:

| App             | Platform | Tools                                           |
| --------------- | -------- | ----------------------------------------------- |
| macOS Reminders | macOS    | createReminder, listReminders, completeReminder |
| Your app here   | -        | -                                               |

### Web Apps (Built-in Descriptors)

Pre-configured descriptors for cold-start scenarios when `.well-known/aai.json` is unavailable:

| App               | Auth Type      | Description              |
| ----------------- | -------------- | ------------------------ |
| **Notion**        | API Key        | All-in-one workspace     |
| **Yuque (语雀)**  | API Key        | Knowledge management     |
| **Feishu (飞书)** | App Credential | Enterprise collaboration |

_More built-in descriptors being added. [Request one](https://github.com/gybob/aai-gateway/issues)_

## Requirements

- Node.js 18 or newer
- macOS (Linux and Windows support planned)
- VS Code, Cursor, Windsurf, Claude Desktop, or any MCP client

## Getting Started

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

## Configuration

| Option      | Description                                                                    |
| ----------- | ------------------------------------------------------------------------------ |
| `--dev`     | Enable development mode. Scans Xcode build directories for apps in development |
| `--scan`    | Scan for AAI-enabled apps and exit (for debugging)                             |
| `--version` | Show version                                                                   |
| `--help`    | Show help                                                                      |

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

## MCP Interface

AAI Gateway exposes **tools only** (no resources). This simplifies the agent workflow.

### `tools/list`

Returns discovered desktop apps plus universal tools:

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
      "description": "Discover web app guide. Use when user mentions a web service not in list.",
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

### App Tool (`app:*`)

Call `app:<app-id>` to get an operation guide:

```json
{
  "name": "app:com.apple.reminders",
  "arguments": {}
}
```

Returns a guide with available operations, parameters, and usage examples.

### Web Discovery (`web:discover`)

Discover web apps by URL, domain, or name:

```json
{
  "name": "web:discover",
  "arguments": { "url": "notion.com" }
}
```

Returns the web app's operation guide.

### Tool Execution (`aai:exec`)

Execute operations after reading the guide:

```json
{
  "name": "aai:exec",
  "arguments": {
    "app": "com.apple.reminders",
    "tool": "createReminder",
    "args": {
      "title": "Submit report",
      "due": "2024-12-31 15:00"
    }
  }
}
```

**Execution flow:**

1. Resolve app descriptor (local, built-in, or web fetch)
2. Show native consent dialog — user approves/denies
3. **Auth**:
   - Desktop apps: Native IPC
   - Web apps: OAuth 2.1 PKCE, API Key, App Credential, or Cookie
4. Execute and return result

## Authentication Types

| Auth Type       | Use Case           | User Flow                          |
| --------------- | ------------------ | ---------------------------------- |
| `oauth2`        | User authorization | Browser-based OAuth 2.0 with PKCE  |
| `apiKey`        | Static API tokens  | Dialog prompts for token           |
| `appCredential` | Enterprise apps    | Dialog prompts for App ID + Secret |
| `cookie`        | No official API    | Manual cookie extraction           |

## Platform Support

| Platform | Discovery                 | IPC Executor    | Consent Dialog    | Secure Storage        |
| -------- | ------------------------- | --------------- | ----------------- | --------------------- |
| macOS    | ✅                        | ✅ Apple Events | ✅ osascript      | ✅ Keychain           |
| Linux    | 🔜                        | 🔜 DBus         | 🔜 zenity/kdialog | 🔜 libsecret          |
| Windows  | 🔜                        | 🔜 COM          | 🔜 PowerShell     | 🔜 Credential Manager |
| Web      | ✅ `.well-known/aai.json` | ✅ HTTP + Auth  | —                 | ✅ (via platform)     |

## For App Developers

To make your app discoverable by AAI Gateway, ship an `aai.json` descriptor:

**macOS:** `<App>.app/Contents/Resources/aai.json`

**Web:** `https://<your-domain>/.well-known/aai.json`

**Example:**

```json
{
  "schemaVersion": "1.0",
  "version": "1.0.0",
  "platform": "web",
  "app": {
    "id": "com.example.api",
    "name": {
      "en": "Example App",
      "zh-CN": "示例应用"
    },
    "defaultLang": "en",
    "description": "Brief description",
    "aliases": ["example", "示例"]
  },
  "auth": {
    "type": "apiKey",
    "apiKey": {
      "location": "header",
      "name": "Authorization",
      "prefix": "Bearer",
      "obtainUrl": "https://example.com/settings/tokens"
    }
  },
  "tools": [...]
}
```

See the [AAI Protocol Spec](https://github.com/gybob/aai-protocol) for the full schema.

## Debugging

```bash
# List discovered AAI-enabled apps
npx aai-gateway --scan

# Include Xcode build products
npx aai-gateway --scan --dev
```

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Links

- [AAI Protocol Spec](https://github.com/gybob/aai-protocol)
- [Report Issues](https://github.com/gybob/aai-gateway/issues)

## License

Apache-2.0
