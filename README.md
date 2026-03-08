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
tools/list returns only lightweight entries:
├── web:discover         → Discover web apps and get their capabilities
├── app:<desktop-app-id> → Discovered desktop apps (one entry per app)
└── aai:exec             → Universal executor for all operations

= 50 apps + 2 tools = 52 entries ✅

Agent calls web:discover or app:<id> on-demand to get detailed operation guides
```

**Result**: **95% reduction** in context usage, faster and more accurate Agent responses.

---

## How It Works

### Web App Discovery & Usage

Web apps are discovered dynamically through descriptors:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Web App Workflow                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. User mentions a web service: "Search my Notion workspace"   │
│                                                                  │
│  2. Agent recognizes "Notion" as a web application              │
│     └─→ Calls web:discover to fetch Notion's capabilities       │
│                                                                  │
│  3. tools/call("web:discover", {url: "notion.com"})              │
│     └─→ Returns: Operation guide with available tools            │
│         - listDatabases()                                        │
│         - queryDatabase(id, filter)                              │
│         - search(query)                                          │
│         - ...                                                    │
│                                                                  │
│  4. tools/call("aai:exec", {                                     │
│       app: "notion.com",                                         │
│       tool: "search",                                            │
│       args: { query: "project docs" }                            │
│     })                                                           │
│     └─→ Executes operation and returns result                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Desktop App Discovery & Usage

Desktop apps are discovered by scanning the local system:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Desktop App Workflow                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. AAI Gateway scans system for AAI-enabled desktop apps       │
│     └─→ Found apps appear as app:<id> entries in tools/list     │
│                                                                  │
│  2. User mentions a desktop app: "Show my work tasks"           │
│     └─→ Agent finds matching app:guanchen.worklens              │
│                                                                  │
│  3. tools/call("app:guanchen.worklens")                          │
│     └─→ Returns: Operation guide with available tools            │
│         - listTasks()                                            │
│         - getTaskDetail(id)                                      │
│         - createTask(title, due)                                 │
│         - ...                                                    │
│                                                                  │
│  4. tools/call("aai:exec", {                                     │
│       app: "guanchen.worklens",                                  │
│       tool: "listTasks",                                         │
│       args: {}                                                   │
│     })                                                           │
│     └─→ Executes operation and returns result                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📱 Supported Apps

### Web Apps (Built-in Descriptors)

These web apps have built-in descriptors and work out of the box:

| App               | Auth Type      | Tools | Description                                         |
| ----------------- | -------------- | ----- | --------------------------------------------------- |
| **Notion**        | API Key        | 11    | Notes, docs, knowledge base, project management     |
| **Yuque (语雀)**  | API Key        | 7     | Alibaba Cloud knowledge management platform         |
| **Feishu / Lark** | App Credential | 11    | Enterprise collaboration (docs, wiki, IM, calendar) |

> 💡 **Adding More**: Any web app can be integrated by providing an `aai.json` descriptor. [Request a built-in descriptor](https://github.com/gybob/aai-gateway/issues)

### Desktop Apps

Currently, no desktop apps have built-in descriptors. Desktop apps can be integrated by:

1. Placing an `aai.json` descriptor in the app bundle
2. AAI Gateway will automatically discover it on startup

---

## 🔍 App Discovery

### Web App Discovery

AAI Gateway discovers web apps through descriptors in this order:

1. **Built-in Registry** - Check internal registry for known apps (Notion, Yuque, Feishu)
2. **Remote Fetch** - Fetch `https://<domain>/.well-known/aai.json` from the web app

### Desktop App Discovery

AAI Gateway scans the following paths for `aai.json` descriptors:

| Platform    | Scan Path                               | Status            |
| ----------- | --------------------------------------- | ----------------- |
| **macOS**   | `<App>.app/Contents/Resources/aai.json` | ✅ Supported      |
| **Linux**   | `/usr/share/<app>/aai.json` (XDG paths) | ⚠️ In development |
| **Windows** | `<App> directory/aai.json`              | ⚠️ In development |

---

## 🔌 Zero-Code Integration

Any app can integrate with AAI Gateway by providing an `aai.json` descriptor—no source code changes required.

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

Returns discovered desktop apps and universal tools:

```json
{
  "tools": [
    {
      "name": "web:discover",
      "description": "Discover web app capabilities. Call with URL/domain to get operation guide.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "url": { "type": "string", "description": "Web app URL, domain, or name" }
        },
        "required": ["url"]
      }
    },
    {
      "name": "app:guanchen.worklens",
      "description": "【Worklens】Desktop task management app. Call to get operation guide.",
      "inputSchema": { "type": "object", "properties": {} }
    },
    {
      "name": "aai:exec",
      "description": "Execute app operation. Call after reading the operation guide.",
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

### `web:discover` - Discover Web Apps

Call with a web app URL, domain, or name to get its capabilities:

```json
{
  "name": "web:discover",
  "arguments": { "url": "notion.com" }
}
```

Returns an operation guide with available tools and their parameters.

### `app:<id>` - Get Desktop App Guide

Call with a discovered desktop app ID to get its capabilities:

```json
{
  "name": "app:guanchen.worklens",
  "arguments": {}
}
```

Returns an operation guide with available tools and their parameters.

### `aai:exec` - Execute Operation

Execute an operation after reading the app's operation guide:

**Web App Example**:

```json
{
  "name": "aai:exec",
  "arguments": {
    "app": "notion.com",
    "tool": "search",
    "args": { "query": "project docs" }
  }
}
```

**Desktop App Example**:

```json
{
  "name": "aai:exec",
  "arguments": {
    "app": "guanchen.worklens",
    "tool": "listTasks",
    "args": {}
  }
}
```

**Execution Flow**:

1. Resolve app descriptor (built-in, cached, or remote fetch)
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
