# AAI Gateway

## One MCP. All Apps. Zero Code Changes.

> A single MCP server that connects AI Agents to all Web and Desktop applications.
> Apps conforming to the AAI Protocol can be **seamlessly integrated** without developing any source code—just provide a descriptor.

[![npm version](https://img.shields.io/npm/v/aai-gateway.svg)](https://www.npmjs.com/package/aai-gateway)
[![License](https://img.shields.io/npm/l/aai-gateway.svg)](https://github.com/gybob/aai-gateway/blob/main/LICENSE)

---

## Why AAI Gateway?

| Traditional Approach                        | AAI Gateway                                       |
| ------------------------------------------- | ------------------------------------------------- |
| One MCP Server per App                      | **One MCP for all applications**                  |
| Requires modifying app code                 | **Zero-code integration, just a descriptor**      |
| Loads all tools at once (context explosion) | **Progressive disclosure, load on-demand**        |
| Platform-specific only                      | **Cross-platform: Web + macOS + Windows + Linux** |

---

## 🚀 Core Innovation: Progressive Disclosure

Traditional MCP servers return all tools on `tools/list`, causing:

```
50 apps × 20 tools per app = 1000+ tool entries
→ Context window explosion
→ Agent performance degradation
→ Reduced response accuracy
```

**AAI Gateway's Solution**:

```
tools/list only returns:
├── web:discover             (Web app discovery)
├── aai:exec                 (Universal executor)
├── app:guanchen.worklens    (Lightweight entry, ~50 bytes)
└── ...

= 50 apps + 2 tools = 52 entries ✅

Agent calls web:discover or app:<id> on-demand to get operation guides
```

**Result**: **95% reduction** in context usage, faster and more accurate Agent responses.

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    Web App Workflow                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. User: "Search my Notion workspace"                          │
│     └─→ Agent matches "Notion" → calls web:discover              │
│                                                                  │
│  2. tools/call("web:discover", {url: "notion.com"})              │
│     └─→ Returns: Operation guide                                 │
│         - listDatabases(), queryDatabase(id), search(query)      │
│         - ...                                                    │
│                                                                  │
│  3. tools/call("aai:exec", {app: "notion.com", tool, args})      │
│     └─→ Executes operation and returns result                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    Desktop App Workflow                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. tools/list                                                   │
│     └─→ Returns: ["app:guanchen.worklens", "web:discover",       │
│                   "aai:exec"]                                    │
│         Only 3 entries! (not 50+ tools)                          │
│                                                                  │
│  2. User: "Show my work tasks"                                  │
│     └─→ Agent matches "worklens" → calls app:guanchen.worklens   │
│                                                                  │
│  3. tools/call("app:guanchen.worklens")                          │
│     └─→ Returns: Operation guide                                 │
│         - listTasks(), getTaskDetail(id), createTask()           │
│         - ...                                                    │
│                                                                  │
│  4. tools/call("aai:exec", {app, tool: "listTasks", args})       │
│     └─→ Executes operation and returns result                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📱 Supported Apps

### Web Apps (Built-in Descriptors)

Built-in descriptors for popular web apps, ready to use:

| App               | Auth Type      | Tools | Description                                         |
| ----------------- | -------------- | ----- | --------------------------------------------------- |
| **Notion**        | API Key        | 11    | Notes, docs, knowledge base, project management     |
| **Yuque (语雀)**  | API Key        | 7     | Alibaba Cloud knowledge management platform         |
| **Feishu / Lark** | App Credential | 11    | Enterprise collaboration (docs, wiki, IM, calendar) |

> 💡 **Expanding**: [Request a new app](https://github.com/gybob/aai-gateway/issues)

### Desktop Apps (Auto-discovered)

AAI Gateway automatically scans installed applications:

| Platform    | Discovery Path                                    | Status             |
| ----------- | ------------------------------------------------- | ------------------ |
| **macOS**   | `/Applications/*.app/Contents/Resources/aai.json` | ✅ Fully supported |
| **Linux**   | XDG standard paths + DBus                         | ⚠️ In development  |
| **Windows** | Program Files + COM                               | ⚠️ In development  |

**Integrated Examples**:

- Worklens (guanchen.worklens): `listTasks`, `getTaskDetail`, `createTask`

---

## 🔌 Zero-Code Integration

Apps conforming to the AAI Protocol can be **seamlessly integrated** with AAI Gateway—no source code modification required.

### Descriptor Location

**Web Apps**:

```
https://<your-domain>/.well-known/aai.json
```

**Desktop Apps**:

```
macOS:   <App>.app/Contents/Resources/aai.json
Windows: <App>.exe directory/aai.json
Linux:   /usr/share/<app>/aai.json
```

### Descriptor Example

```json
{
  "schemaVersion": "1.0",
  "version": "1.0.0",
  "platform": "web",
  "app": {
    "id": "com.example.myapp",
    "name": {
      "en": "My App",
      "zh-CN": "我的应用"
    },
    "defaultLang": "en",
    "description": "App description",
    "aliases": ["myapp", "我的应用"]
  },
  "auth": {
    "type": "apiKey",
    "apiKey": {
      "location": "header",
      "name": "Authorization",
      "prefix": "Bearer",
      "obtainUrl": "https://example.com/settings/tokens",
      "instructions": {
        "short": "Get API Token from settings page",
        "helpUrl": "https://example.com/docs/api"
      }
    }
  },
  "tools": [
    {
      "name": "getData",
      "description": "Get data by ID",
      "parameters": {
        "type": "object",
        "properties": {
          "id": { "type": "string", "description": "Data ID" }
        },
        "required": ["id"]
      },
      "execution": {
        "path": "/data/{id}",
        "method": "GET"
      }
    }
  ]
}
```

> 📖 **Full Protocol Spec**: [AAI Protocol Spec](https://github.com/gybob/aai-protocol)

---

## Quick Start

### Installation

Add AAI Gateway to your MCP client configuration:

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

### Client Configuration

<details>
<summary>Claude Code</summary>

```bash
claude mcp add aai-gateway npx aai-gateway
```

</details>

<details>
<summary>Claude Desktop</summary>

Follow the [MCP installation guide](https://modelcontextprotocol.io/quickstart/user) using the standard config above.

Config file location: `~/Library/Application Support/Claude/claude_desktop_config.json`

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

Go to `Cursor Settings` → `MCP` → `Add new MCP Server`

- Name: `aai-gateway`
- Type: `command`
- Command: `npx aai-gateway`

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

Development mode (scans Xcode build directories):

```json
{
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

---

## CLI Options

| Option      | Description                                        |
| ----------- | -------------------------------------------------- |
| `--dev`     | Development mode, scans Xcode build directories    |
| `--scan`    | Scan for AAI-enabled apps and exit (for debugging) |
| `--version` | Show version number                                |
| `--help`    | Show help information                              |

---

## MCP Interface

AAI Gateway exposes **tools only** (no resources), simplifying the Agent workflow.

### `tools/list`

Returns discovered apps and universal tools:

```json
{
  "tools": [
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
    },
    {
      "name": "app:guanchen.worklens",
      "description": "【Worklens】macOS task management app. Call to get guide.",
      "inputSchema": { "type": "object", "properties": {} }
    }
  ]
}
```

### `web:discover` - Discover Web Apps

```json
{
  "name": "web:discover",
  "arguments": { "url": "notion.com" }
}
```

Returns the web app's operation guide.

### `app:<id>` - Get Desktop App Guide

```json
{
  "name": "app:guanchen.worklens",
  "arguments": {}
}
```

Returns the desktop app's available operations, parameters, and examples.

### `aai:exec` - Execute Operation

```json
{
  "name": "aai:exec",
  "arguments": {
    "app": "notion.com",
    "tool": "search",
    "args": {
      "query": "project docs"
    }
  }
}
```

**Execution Flow**:

1. Resolve app descriptor (local, built-in, or remote fetch)
2. Show native consent dialog — user approves or denies
3. **Authentication**:
   - Desktop apps: Native IPC (AppleScript/COM/DBus)
   - Web apps: OAuth 2.1 PKCE / API Key / App Credential / Cookie
4. Execute and return result

---

## Authentication Types

| Type            | Use Case           | User Flow                          |
| --------------- | ------------------ | ---------------------------------- |
| `oauth2`        | User authorization | Browser-based OAuth 2.0 + PKCE     |
| `apiKey`        | Static API tokens  | Dialog prompts for token           |
| `appCredential` | Enterprise apps    | Dialog prompts for App ID + Secret |
| `cookie`        | No official API    | Manual cookie extraction           |

---

## Platform Support

| Platform    | App Discovery             | IPC Executor    | Consent Dialog    | Secure Storage        |
| ----------- | ------------------------- | --------------- | ----------------- | --------------------- |
| **macOS**   | ✅                        | ✅ Apple Events | ✅ osascript      | ✅ Keychain           |
| **Linux**   | ⚠️ XDG paths              | ⚠️ DBus         | ⚠️ zenity/kdialog | ⚠️ libsecret          |
| **Windows** | ⚠️ Program Files          | ⚠️ COM          | ⚠️ PowerShell     | ⚠️ Credential Manager |
| **Web**     | ✅ `.well-known/aai.json` | ✅ HTTP + Auth  | —                 | ✅ (via platform)     |

> Legend: ✅ Fully supported | ⚠️ Basic implementation (in development)

---

## Debugging

```bash
# List discovered AAI-enabled apps
npx aai-gateway --scan

# Include Xcode build products
npx aai-gateway --scan --dev
```

---

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

---

## Links

- [AAI Protocol Spec](https://github.com/gybob/aai-protocol) - Protocol specification
- [Report Issues](https://github.com/gybob/aai-gateway/issues) - Bug reports and feature requests

---

## License

Apache-2.0
