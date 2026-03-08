# AAI Gateway

## One MCP. All Apps. Zero Code Changes.

> A single MCP server that connects AI Agents to all Web and Desktop applications.
> Apps conforming to the **[AAI Protocol](https://github.com/gybob/aai-protocol)** can be **seamlessly integrated** without developing any source code—just provide a descriptor.

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

### Web App Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│  1. User: "Search my Notion workspace"                          │
│                                                                  │
│  2. Agent recognizes "Notion" as a web application              │
│     └─→ Calls web:discover to fetch Notion's capabilities       │
│                                                                  │
│  3. tools/call("web:discover", {url: "notion.com"})              │
│     └─→ Returns: Operation guide                                 │
│         - listDatabases(), queryDatabase(id), search(query)      │
│                                                                  │
│  4. tools/call("aai:exec", {                                     │
│       app: "notion.com",                                         │
│       tool: "search",                                            │
│       args: { query: "project docs" }                            │
│     })                                                           │
│     └─→ Executes operation and returns result                     │
└─────────────────────────────────────────────────────────────────┘
```

### Desktop App Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│  1. AAI Gateway scans system for AAI-enabled desktop apps       │
│     └─→ Found apps appear as app:<id> entries in tools/list     │
│                                                                  │
│  2. User: "Show my work tasks"                                  │
│     └─→ Agent finds matching app:guanchen.worklens              │
│                                                                  │
│  3. tools/call("app:guanchen.worklens")                          │
│     └─→ Returns: Operation guide                                 │
│         - listTasks(), getTaskDetail(id), createTask(title)     │
│                                                                  │
│  4. tools/call("aai:exec", {                                     │
│       app: "guanchen.worklens",                                  │
│       tool: "listTasks",                                         │
│       args: {}                                                   │
│     })                                                           │
│     └─→ Executes operation and returns result                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📱 Supported Apps

These apps have built-in descriptors and work out of the box:

| App               | Auth Type      | Tools | Description                                         |
| ----------------- | -------------- | ----- | --------------------------------------------------- |
| **Notion**        | API Key        | 11    | Notes, docs, knowledge base, project management     |
| **Yuque (语雀)**  | API Key        | 7     | Alibaba Cloud knowledge management platform         |
| **Feishu / Lark** | App Credential | 11    | Enterprise collaboration (docs, wiki, IM, calendar) |

> 💡 Want to add your app? See [How to Integrate](#-how-to-integrate) | [Upcoming Apps](#upcoming-apps)

---

## Installation

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

<details>
<summary>Claude Code</summary>

```bash
claude mcp add aai-gateway npx aai-gateway
```

</details>

<details>
<summary>Claude Desktop</summary>

Follow the [MCP installation guide](https://modelcontextprotocol.io/quickstart/user). Config location: `~/Library/Application Support/Claude/claude_desktop_config.json`

</details>

<details>
<summary>Copilot / VS Code</summary>

```bash
code --add-mcp '{"name":"aai-gateway","command":"npx","args":["aai-gateway"]}'
```

</details>

<details>
<summary>Cursor</summary>

`Cursor Settings` → `MCP` → `Add new MCP Server`. Name: `aai-gateway`, Type: `command`, Command: `npx aai-gateway`

</details>

<details>
<summary>OpenCode</summary>

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

</details>

---

## CLI Options

| Option      | Description                                     |
| ----------- | ----------------------------------------------- |
| `--dev`     | Development mode, scans Xcode build directories |
| `--scan`    | Scan for AAI-enabled apps and exit (debugging)  |
| `--version` | Show version                                    |
| `--help`    | Show help                                       |

---

## MCP Interface

### `tools/list`

```json
{
  "tools": [
    { "name": "web:discover", "description": "Discover web app capabilities..." },
    { "name": "app:guanchen.worklens", "description": "Desktop app. Call to get guide." },
    { "name": "aai:exec", "description": "Execute app operation..." }
  ]
}
```

### `web:discover` - Discover Web Apps

```json
{ "name": "web:discover", "arguments": { "url": "notion.com" } }
```

Returns operation guide with available tools.

### `app:<id>` - Get Desktop App Guide

```json
{ "name": "app:guanchen.worklens", "arguments": {} }
```

Returns operation guide with available tools.

### `aai:exec` - Execute Operation

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

**Execution Flow**: Resolve descriptor → Show consent dialog → Authenticate → Execute → Return result

---

## Authentication Types

| Type            | Use Case           | User Flow                  |
| --------------- | ------------------ | -------------------------- |
| `oauth2`        | User authorization | Browser OAuth 2.0 + PKCE   |
| `apiKey`        | Static API tokens  | Dialog prompts for token   |
| `appCredential` | Enterprise apps    | Dialog for App ID + Secret |
| `cookie`        | No official API    | Manual cookie extraction   |

---

## Platform Support

| Platform    | Discovery                 | IPC             | Consent       | Storage               |
| ----------- | ------------------------- | --------------- | ------------- | --------------------- |
| **macOS**   | ✅                        | ✅ Apple Events | ✅ osascript  | ✅ Keychain           |
| **Linux**   | ⚠️ XDG                    | ⚠️ DBus         | ⚠️ zenity     | ⚠️ libsecret          |
| **Windows** | ⚠️ Program Files          | ⚠️ COM          | ⚠️ PowerShell | ⚠️ Credential Manager |
| **Web**     | ✅ `.well-known/aai.json` | ✅ HTTP+Auth    | —             | ✅                    |

> Legend: ✅ Supported | ⚠️ In development

---

## 🔌 How to Integrate

Any app can integrate with AAI Gateway by providing an `aai.json` descriptor.

### Descriptor Location

| Platform    | Location                                     |
| ----------- | -------------------------------------------- |
| **Web**     | `https://<your-domain>/.well-known/aai.json` |
| **macOS**   | `<App>.app/Contents/Resources/aai.json`      |
| **Windows** | `<App>.exe directory/aai.json`               |
| **Linux**   | `/usr/share/<app>/aai.json`                  |

### Descriptor Format

The descriptor follows the **[AAI Protocol specification](https://github.com/gybob/aai-protocol/blob/main/spec/aai-json.md)**. Key points:

- **All field names use camelCase** (e.g., `schemaVersion`, `baseUrl`)
- Supports **internationalized names** with language fallback
- **Auth types**: `oauth2`, `apiKey`, `appCredential`, `cookie`
- **Tools** defined with JSON Schema parameters

For the complete descriptor specification, see **[aai.json Descriptor Spec](https://github.com/gybob/aai-protocol/blob/main/spec/aai-json.md)**.

---

## Appendix

### Upcoming Apps

The following apps are planned for future integration:

> _(List to be added)_

Want to see your app here? [Open an issue](https://github.com/gybob/aai-gateway/issues).

---

## Links

- **[AAI Protocol Spec](https://github.com/gybob/aai-protocol)** - Protocol specification
- [Report Issues](https://github.com/gybob/aai-gateway/issues) - Bug reports and feature requests

---

## License

Apache-2.0
