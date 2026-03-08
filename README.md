# AAI Gateway

## One MCP. All Apps. Zero Code Changes.

> 通过一个 MCP 服务器，让 AI Agent 接入所有 Web 应用和桌面应用。
> 符合 AAI 协议的应用可**无缝接入**，无需开放任何源代码，只需提供描述符。

[![npm version](https://img.shields.io/npm/v/aai-gateway.svg)](https://www.npmjs.com/package/aai-gateway)
[![License](https://img.shields.io/npm/l/aai-gateway.svg)](https://github.com/gybob/aai-gateway/blob/main/LICENSE)

---

## 为什么选择 AAI Gateway？

| 传统方案                       | AAI Gateway                               |
| ------------------------------ | ----------------------------------------- |
| 每个 App 一个 MCP Server       | **一个 MCP 接入所有应用**                 |
| 需要修改应用代码               | **零代码接入，只需描述符**                |
| 一次加载所有工具（上下文爆炸） | **渐进式披露，按需加载**                  |
| 仅支持特定平台                 | **跨平台：Web + macOS + Windows + Linux** |

---

## 🚀 核心创新：渐进式披露（Progressive Disclosure）

传统 MCP 服务器在 `tools/list` 时返回所有工具，导致：

```
50 个应用 × 每应用 20 个工具 = 1000+ 工具条目
→ 上下文窗口爆炸
→ Agent 性能下降
→ 响应精度降低
```

**AAI Gateway 的解决方案**：

```
tools/list 只返回:
├── app:com.apple.reminders  (轻量入口，50 字节)
├── app:com.apple.mail       (轻量入口，50 字节)
├── web:discover             (Web 应用发现)
└── aai:exec                 (统一执行器)

= 50 apps + 2 工具 = 52 条目 ✅

Agent 按需调用 app:<id> 获取详细操作指南
```

**效果**：上下文占用减少 **95%**，Agent 响应更精准、更快速。

---

## 工作流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    桌面应用工作流                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. tools/list                                                   │
│     └─→ 返回: ["app:com.apple.mail", "app:com.apple.calendar",  │
│               "web:discover", "aai:exec"]                        │
│         仅 4 条目！（而非 50+ 工具）                              │
│                                                                  │
│  2. 用户: "发邮件给张三"                                         │
│     └─→ Agent 匹配 "邮件" → 调用 app:com.apple.mail              │
│                                                                  │
│  3. tools/call("app:com.apple.mail")                            │
│     └─→ 返回: 操作指南                                           │
│         - sendEmail(to, subject, body)                           │
│         - readInbox(folder, limit)                               │
│         - ...                                                    │
│                                                                  │
│  4. tools/call("aai:exec", {app, tool: "sendEmail", args})       │
│     └─→ 执行操作并返回结果                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    Web 应用工作流                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. 用户: "搜索我的 Notion 空间"                                 │
│     └─→ Agent 匹配 "Notion" → 调用 web:discover                  │
│                                                                  │
│  2. tools/call("web:discover", {url: "notion.com"})              │
│     └─→ 返回: 操作指南                                           │
│         - listDatabases(), queryDatabase(id), search(query)      │
│         - ...                                                    │
│                                                                  │
│  3. tools/call("aai:exec", {app: "notion.com", tool, args})      │
│     └─→ 执行操作并返回结果                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📱 支持的应用

### Web 应用（内置描述符）

内置主流 Web 应用的描述符，开箱即用：

| 应用             | 认证方式       | 工具数 | 说明                                 |
| ---------------- | -------------- | ------ | ------------------------------------ |
| **Notion**       | API Key        | 11     | 笔记、文档、知识库、项目管理         |
| **语雀 (Yuque)** | API Key        | 7      | 阿里云知识管理平台                   |
| **飞书 / Lark**  | App Credential | 11     | 企业协作平台（文档、Wiki、IM、日历） |

> 💡 **持续扩展中**：[申请添加新应用](https://github.com/gybob/aai-gateway/issues)

### 桌面应用（自动发现）

AAI Gateway 自动扫描系统中安装的应用：

| 平台        | 发现路径                                          | 状态        |
| ----------- | ------------------------------------------------- | ----------- |
| **macOS**   | `/Applications/*.app/Contents/Resources/aai.json` | ✅ 完整支持 |
| **Linux**   | XDG 标准路径 + DBus                               | ⚠️ 开发中   |
| **Windows** | Program Files + COM                               | ⚠️ 开发中   |

**已适配示例**：

- macOS Reminders: `createReminder`, `listReminders`, `completeReminder`

---

## 🔌 零代码接入

符合 AAI 协议的应用可以**无缝接入** AAI Gateway，无需修改任何源代码。

### 描述符放置位置

**Web 应用**：

```
https://<your-domain>/.well-known/aai.json
```

**桌面应用**：

```
macOS:   <App>.app/Contents/Resources/aai.json
Windows: <App>.exe 同级目录/aai.json
Linux:   /usr/share/<app>/aai.json
```

### 描述符示例

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
    "description": "应用简介",
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
        "short": "从设置页面获取 API Token",
        "helpUrl": "https://example.com/docs/api"
      }
    }
  },
  "tools": [
    {
      "name": "getData",
      "description": "获取数据",
      "parameters": {
        "type": "object",
        "properties": {
          "id": { "type": "string", "description": "数据ID" }
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

> 📖 **完整协议规范**：[AAI Protocol Spec](https://github.com/gybob/aai-protocol)

---

## 快速开始

### 安装

添加 AAI Gateway 到你的 MCP 客户端配置：

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

### 客户端配置

<details>
<summary>Claude Code</summary>

```bash
claude mcp add aai-gateway npx aai-gateway
```

</details>

<details>
<summary>Claude Desktop</summary>

按照 [MCP 安装指南](https://modelcontextprotocol.io/quickstart/user) 操作，使用上述标准配置。

配置文件位置：`~/Library/Application Support/Claude/claude_desktop_config.json`

</details>

<details>
<summary>Copilot / VS Code</summary>

```bash
code --add-mcp '{"name":"aai-gateway","command":"npx","args":["aai-gateway"]}'
```

或手动添加到 MCP 设置中。

</details>

<details>
<summary>Cursor</summary>

进入 `Cursor Settings` → `MCP` → `Add new MCP Server`

- Name: `aai-gateway`
- Type: `command`
- Command: `npx aai-gateway`

</details>

<details>
<summary>OpenCode</summary>

添加到 `~/.config/opencode/opencode.json`：

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

开发模式（扫描 Xcode 构建目录）：

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

## 命令行选项

| 选项        | 说明                                  |
| ----------- | ------------------------------------- |
| `--dev`     | 开发模式，扫描 Xcode 构建目录         |
| `--scan`    | 扫描已发现的 AAI 应用并退出（调试用） |
| `--version` | 显示版本号                            |
| `--help`    | 显示帮助信息                          |

---

## MCP 接口

AAI Gateway 仅暴露 **工具**（无资源），简化 Agent 工作流。

### `tools/list`

返回已发现的桌面应用和通用工具：

```json
{
  "tools": [
    {
      "name": "app:com.apple.reminders",
      "description": "【Reminders|提醒事项】macOS reminders app. Aliases: todo, 待办. Call to get guide.",
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

### `app:<id>` - 获取操作指南

```json
{
  "name": "app:com.apple.reminders",
  "arguments": {}
}
```

返回该应用的可用操作、参数和示例。

### `web:discover` - 发现 Web 应用

```json
{
  "name": "web:discover",
  "arguments": { "url": "notion.com" }
}
```

返回该 Web 应用的操作指南。

### `aai:exec` - 执行操作

```json
{
  "name": "aai:exec",
  "arguments": {
    "app": "com.apple.reminders",
    "tool": "createReminder",
    "args": {
      "title": "提交报告",
      "due": "2024-12-31 15:00"
    }
  }
}
```

**执行流程**：

1. 解析应用描述符（本地、内置或远程获取）
2. 显示原生授权对话框 — 用户批准或拒绝
3. **认证**：
   - 桌面应用：原生 IPC（AppleScript/COM/DBus）
   - Web 应用：OAuth 2.1 PKCE / API Key / App Credential / Cookie
4. 执行并返回结果

---

## 认证类型

| 类型            | 适用场景       | 用户流程                   |
| --------------- | -------------- | -------------------------- |
| `oauth2`        | 用户授权       | 浏览器 OAuth 2.0 + PKCE    |
| `apiKey`        | 静态 API Token | 对话框输入 Token           |
| `appCredential` | 企业应用       | 对话框输入 App ID + Secret |
| `cookie`        | 无官方 API     | 手动提取 Cookie            |

---

## 平台支持

| 平台        | 应用发现                  | IPC 执行器      | 授权对话框        | 安全存储              |
| ----------- | ------------------------- | --------------- | ----------------- | --------------------- |
| **macOS**   | ✅                        | ✅ Apple Events | ✅ osascript      | ✅ Keychain           |
| **Linux**   | ⚠️ XDG paths              | ⚠️ DBus         | ⚠️ zenity/kdialog | ⚠️ libsecret          |
| **Windows** | ⚠️ Program Files          | ⚠️ COM          | ⚠️ PowerShell     | ⚠️ Credential Manager |
| **Web**     | ✅ `.well-known/aai.json` | ✅ HTTP + Auth  | —                 | ✅ (via platform)     |

> 图例：✅ 完整支持 | ⚠️ 基础实现（开发中）

---

## 调试

```bash
# 列出已发现的 AAI 应用
npx aai-gateway --scan

# 包含 Xcode 构建产物
npx aai-gateway --scan --dev
```

---

## 开发

```bash
npm install
npm run typecheck
npm test
npm run build
```

---

## 链接

- [AAI Protocol Spec](https://github.com/gybob/aai-protocol) - 协议规范
- [Report Issues](https://github.com/gybob/aai-gateway/issues) - 问题反馈

---

## License

Apache-2.0
