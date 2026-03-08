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
1. User: "Search my Notion workspace"
2. Agent recognizes "Notion" as a web application
   → Calls web:discover to fetch Notion's capabilities
3. tools/call("web:discover", {url: "notion.com"})
   → Returns operation guide: listDatabases(), queryDatabase(id), search(query)
4. tools/call("aai:exec", {app: "notion.com", tool: "search", args: {...}})
   → Executes and returns result
```

### Desktop App Workflow

```
1. AAI Gateway scans system for AAI-enabled desktop apps
   → Found apps appear as app:<id> entries in tools/list
2. User: "Show my work tasks"
   → Agent finds matching app:guanchen.worklens
3. tools/call("app:guanchen.worklens")
   → Returns operation guide: listTasks(), getTaskDetail(id), createTask()
4. tools/call("aai:exec", {app: "guanchen.worklens", tool: "listTasks", args: {}})
   → Executes and returns result
```

---

## 🔐 Security & Consent

AAI Gateway implements a **caller-aware consent mechanism** to protect user privacy and control:

### Per-Caller Authorization

- **Client Identification**: When an MCP client (Claude Desktop, Cursor, Windsurf, etc.) requests tool access, AAI Gateway identifies the caller from the MCP protocol metadata
- **Isolated Consent**: Consent decisions are stored **per caller**, meaning authorization granted to Claude Desktop is NOT automatically granted to Cursor
- **Clear Dialogs**: Consent dialogs clearly show which client is requesting access: "Claude Desktop wants to use: sendEmail"
- **Re-authorization Required**: Different MCP clients must obtain their own authorization for the same tools

### Consent Flow

```
1. MCP client (e.g., Cursor) calls a tool for the first time
2. AAI Gateway checks: Has Cursor been authorized for this tool?
3. If not → Show consent dialog: "Cursor wants to use: sendEmail"
4. User decision is stored with caller identity: consents["Cursor"]["com.example.mail"]["sendEmail"]
5. Next call from Cursor → No dialog (already authorized)
6. Claude Desktop calls same tool → Consent dialog shown (different caller)
```

This ensures that each MCP client has explicit user authorization, preventing cross-client authorization leakage.

> 💡 **Note**: Caller identity is informational and not a security boundary. The real security is enforced by the operating system (TCC on macOS, UAC on Windows, etc.).
---

## 📱 Supported Apps

These apps have built-in descriptors and work out of the box:

| App               | Auth Type      | Tools | Description                                         |
| ----------------- | -------------- | ----- | --------------------------------------------------- |
| **Notion**        | API Key        | 11    | Notes, docs, knowledge base, project management     |
| **Yuque (语雀)**  | API Key        | 7     | Alibaba Cloud knowledge management platform         |
| **Feishu / Lark** | App Credential | 11    | Enterprise collaboration (docs, wiki, IM, calendar) |
> 💡 Want to add your app? See [How to Integrate](#how-to-integrate) | [Upcoming Apps](#upcoming-apps)

> ⚠️ **Note**: AAI Gateway is currently in active development. Bugs may exist. Contributions are welcome!

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

Follow the [MCP installation guide](https://modelcontextprotocol.io/quickstart/user). Config: `~/Library/Application Support/Claude/claude_desktop_config.json`

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
| `--scan`    | Scan for AAI-enabled apps and exit              |
| `--version` | Show version                                    |
| `--help`    | Show help                                       |

---

## Appendix

### How to Integrate

There are two ways to integrate an app with AAI Gateway:

#### Method 1: Provide a Descriptor File

Place an `aai.json` descriptor at the standard location:

| Platform    | Location                                     |
| ----------- | -------------------------------------------- |
| **Web**     | `https://<your-domain>/.well-known/aai.json` |
| **macOS**   | `<App>.app/Contents/Resources/aai.json`      |
| **Windows** | `<App>.exe directory/aai.json`               |
| **Linux**   | `/usr/share/<app>/aai.json`                  |

AAI Gateway will automatically discover and load the descriptor.

#### Method 2: Contribute to Built-in Registry

For web apps without a hosted descriptor, you can add a built-in descriptor to AAI Gateway:

1. Create `src/discovery/descriptors/<app>.ts` following existing patterns
2. Register in `src/discovery/web-registry.ts`
3. Submit a pull request

This is useful for:

- Apps without official API documentation
- Custom auth configurations
- Cold-start scenarios

#### Descriptor Format

The descriptor follows the **[AAI Protocol specification](https://github.com/gybob/aai-protocol/blob/main/spec/aai-json.md)**. Key points:

- All field names use **camelCase** (e.g., `schemaVersion`, `baseUrl`)
- Supports **internationalized names** with language fallback
- Auth types: `oauth2`, `apiKey`, `appCredential`, `cookie`
- Tools defined with JSON Schema parameters

For the complete spec, see **[aai.json Descriptor Spec](https://github.com/gybob/aai-protocol/blob/main/spec/aai-json.md)**.

#### Supported Auth Types

| Type            | Use Case           | User Flow                  |
| --------------- | ------------------ | -------------------------- |
| `oauth2`        | User authorization | Browser OAuth 2.0 + PKCE   |
| `apiKey`        | Static API tokens  | Dialog prompts for token   |
| `appCredential` | Enterprise apps    | Dialog for App ID + Secret |
| `cookie`        | No official API    | Manual cookie extraction   |

#### Platform Support

| Platform    | Discovery              | IPC          | Consent   | Storage  |
| ----------- | ---------------------- | ------------ | --------- | -------- |
| **macOS**   | Supported              | Apple Events | osascript | Keychain |
| **Linux**   | XDG paths              | DBus (gdbus)  | zenity/kdialog | libsecret |
| **Windows** | Program Files          | COM (PowerShell) | PowerShell | CredMan  |
| **Web**     | `.well-known/aai.json` | HTTP         | N/A       | Platform |

> **Note**: Linux and Windows implementations are functional but may require additional testing and refinement. Contributions are welcome!

#### Windows Requirements

- **PowerShell 5.1+** (comes with Windows 10+)
- **Execution Policy**: Must allow script execution
  ```powershell
  # Check current policy
  Get-ExecutionPolicy
  
  # Set to allow local scripts (recommended)
  Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```
- **Credential Manager**: Built-in Windows feature, no additional setup needed

#### Linux Requirements

- **DBus**: Usually pre-installed on modern Linux distributions
- **Dialog Tools**: Install one of the following:
  ```bash
  # Ubuntu/Debian
  sudo apt install zenity  # or kdialog
  
  # Fedora
  sudo dnf install zenity  # or kdialog
  
  # Arch Linux
  sudo pacman -S zenity  # or kdialog
  ```
- **libsecret**: For secure credential storage
  ```bash
  # Ubuntu/Debian
  sudo apt install libsecret-tools
  
  # Fedora
  sudo dnf install libsecret
  ```

---

### Upcoming Apps

The following apps are planned for future integration, organized by priority:

#### 🚀 Priority P0 - High Activity + Simple Integration

> Target: 1-2 weeks | MCP ecosystem's most active Web Apps

| App | Auth Type | API Base | Description |
|-----|-----------|----------|-------------|
| **GitHub** | OAuth2 / API Key | `api.github.com` | Code hosting, repositories, issues, PRs |
| **Linear** | API Key | `api.linear.app` | Modern project management |
| **Stripe** | API Key | `api.stripe.com` | Payment processing |
| **Slack** | OAuth2 / Bot Token | `slack.com/api` | Team messaging and channels |
| **Jira** | OAuth2 / API Token | `api.atlassian.com` | Issue and project tracking |

#### 🔥 Priority P1 - High Activity

> Target: 2-4 weeks | Popular SaaS applications

| App | Auth Type | API Base | Description |
|-----|-----------|----------|-------------|
| **Google Drive** | OAuth2 | `www.googleapis.com/drive` | Cloud storage and files |
| **Google Calendar** | OAuth2 | `www.googleapis.com/calendar` | Calendar and scheduling |
| **Airtable** | API Key / OAuth2 | `api.airtable.com` | Database and spreadsheets |
| **Trello** | API Key + Token | `api.trello.com/1` | Kanban boards |
| **Asana** | API Key / OAuth2 | `app.asana.com/api/1.0` | Project management |
| **Discord** | Bot Token / OAuth2 | `discord.com/api/v10` | Community messaging |
| **GitLab** | API Key / OAuth2 | `gitlab.com/api/v4` | DevOps platform |

#### 📈 Priority P2 - Medium Activity

> Target: 1-2 months | Project management, communication, data, payments

**Project Management & Collaboration:**

| App | Auth Type | Description |
|-----|-----------|-------------|
| Monday.com | API Key | Work management platform |
| ClickUp | API Key | Productivity platform |
| Basecamp | OAuth2 | Project collaboration |
| Bitbucket | API Key / OAuth2 | Git repository hosting |

**Communication & Email:**

| App | Auth Type | Description |
|-----|-----------|-------------|
| Gmail | OAuth2 | Email by Google |
| Microsoft Outlook | OAuth2 | Email by Microsoft |
| SendGrid | API Key | Email delivery service |
| Mailgun | API Key | Email API service |
| Twilio | API Key | SMS and voice API |

**Data & Databases:**

| App | Auth Type | Description |
|-----|-----------|-------------|
| Supabase | API Key | Backend-as-a-Service |
| PlanetScale | API Key | Serverless MySQL |
| Neon | API Key | Serverless PostgreSQL |

**Payments & Commerce:**

| App | Auth Type | Description |
|-----|-----------|-------------|
| PayPal | OAuth2 | Payment platform |
| Square | API Key | Payment processing |
| Shopify | API Key | E-commerce platform |

#### 🔍 Priority P3 - Search & AI

> Target: 2-3 months | AI-powered search services

| App | Auth Type | API Base | Description |
|-----|-----------|----------|-------------|
| Brave Search | API Key | `api.search.brave.com/res/v1` | Privacy-focused search |
| Perplexity | API Key | `api.perplexity.ai` | AI search engine |
| Exa | API Key | `api.exa.ai` | AI-powered search |
| Tavily | API Key | `api.tavily.com` | Search API for AI |

#### 🇨🇳 China Region Services

> Target: 2-3 months | Localized services for Chinese users

| App | Auth Type | Description |
|-----|-----------|-------------|
| **Yuque (语雀)** | API Key | ✅ Already supported |
| **Feishu (飞书)** | App Credential | ✅ Already supported |
| DingTalk (钉钉) | App Credential | Enterprise messaging |
| WeCom (企业微信) | App Credential | Enterprise WeChat |
| Tencent Meeting | OAuth2 / App Credential | Video conferencing |
| Aliyun Drive | OAuth2 | Cloud storage |
| Baidu Netdisk | OAuth2 | Cloud storage |
| Gitee | API Key | Code hosting |
| WeChat Pay | App Credential | Payment platform |

---

#### ❌ Not Suitable for AAI Gateway

The following MCP server types are **NOT suitable** for AAI Gateway as they require local implementation:

| Type | Examples | Reason |
|------|----------|--------|
| Local Filesystem | Filesystem, Memory | Requires local file access |
| Version Control | Git | Requires local git commands |
| Browser Automation | Playwright, Puppeteer | Requires browser instance |
| Code Execution | E2B, Riza | Requires sandbox environment |
| Database Drivers | PostgreSQL, MySQL, SQLite | Requires database drivers |
| System Commands | Shell, Terminal | Requires local command execution |

---

Want to see your app prioritized? [Open an issue](https://github.com/gybob/aai-gateway/issues).
---

## Links

- **[AAI Protocol Spec](https://github.com/gybob/aai-protocol)** - Protocol specification
- [Report Issues](https://github.com/gybob/aai-gateway/issues) - Bug reports and feature requests

---

## License

Apache-2.0
