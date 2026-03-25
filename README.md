# AAI Gateway

## One MCP. Many Apps. Less Context.

AAI Gateway turns many apps, agents, skills, and MCP servers into one MCP server.

## 核心价值

### 价值 1：自然语言驱动的工具接入

安装 AAI Gateway MCP 之后，你可以通过自然语言描述快速接入其他任意 MCP、技能，并操控其他 AI Agent 工具（包括 Claude Code、Codex、OpenCode 等）。

AAI Gateway 还集成搜索工具，可以帮助你从权威、主流的网站上搜索官方、安全的 MCP 和技能，并实现一句话安装。

### 价值 2：渐进式披露策略

AAI Gateway 不会一次性向大模型上下文中塞入所有工具的描述，而是采用渐进式披露策略：

**MCP Server 级别**：先只暴露 MCP Server 的整体描述。当大模型发现需要使用某个具体工具时，会先返回工具使用指导，然后 Agent 根据指导调用统一的 `aai:exec` 去执行。`aai:exec` 接受 `appId`、`tool`、`tool args` 作为参数。

**MCP / 技能 描述级别**：提供两个层级的披露策略：

- `summary` — 自然语言描述，适合自动触发
- `keywords` — 紧凑的关键词集合，进一步简化上下文占用

这让 OpenCode 这种需要大量工具和技能的场景下依然能良好运行。

## 使用方案

### 1. 安装 AAI Gateway MCP

你不需要预装 `aai-gateway`。只需将其注册为用户级 MCP 服务器，通过 `npx` 启动即可。

#### Claude Code

```bash
claude mcp add --scope user --transport stdio aai-gateway -- npx -y aai-gateway
```

#### Codex

```bash
codex mcp add aai-gateway -- npx -y aai-gateway
```

#### OpenCode

在 `~/.config/opencode/opencode.json` 中添加：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "aai-gateway": {
      "type": "local",
      "command": ["npx", "-y", "aai-gateway"],
      "enabled": true
    }
  }
}
```

### 2. 搜索并安装 MCP 或技能

如果你不知道该安装哪个 MCP 或技能，可以让 AI 工具调用 `import:search`。

`import:search` 会：

- 将用户请求转换为搜索关键词
- 推荐更安全的权威来源优先搜索
- 将搜索结果规范化为候选列表
- 为每个候选项生成临时 ID 供用户确认
- 将确认的项目路由到 `mcp:import` 或 `skill:import` 流程

**推荐的搜索来源顺序**：

1. 官方目录：`modelcontextprotocol/registry`、`modelcontextprotocol/servers`、`openai/skills`
2. 社区精选列表：`punkpeye/awesome-mcp-servers`、`ComposioHQ/awesome-claude-skills`
3. 高审查来源：如 ClawHub 等开放市场（需额外谨慎）

> 注意：推荐列表是首选起点，而非硬性白名单。请勿随意推荐来自不知名小网站工具。对于市场平台，请额外检查维护者身份、仓库活跃度、README 质量和许可证是否可见。

### 3. 导入 MCP Server

主流程：复制主流 MCP 配置片段到 AI 工具，让它通过 AAI Gateway 导入。

AI 工具会：

1. 读取你粘贴的 MCP 配置
2. 询问你选择暴露模式
3. 调用 `mcp:import`

AAI Gateway 保持导入参数与标准 MCP 配置格式一致：

- stdio MCP：`command`、`args`、`env`、`cwd`
- remote MCP：`url`、可选 `transport`、可选 `headers`

导入前请选择暴露模式：

- `summary`：更容易自动触发
- `keywords`：为更多工具留出空间，但通常需要更明确的关键词提及

**stdio MCP 示例**：

```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
}
```

**Remote Streamable HTTP MCP 示例**：

```json
{
  "url": "https://example.com/mcp"
}
```

**Remote SSE MCP 示例**：

```json
{
  "url": "https://example.com/sse",
  "transport": "sse"
}
```

导入完成后，AAI Gateway 返回：

- 生成的 app id
- 生成的 `keywords`
- 生成的 `summary`
- 引导工具名称：`app:<id>`

> **重要**：导入后需重启 AI 工具才能使用新导入的工具。重启后，导入的应用将显示为 `app:<id>`，使用 `aai:exec` 执行实际操作。

### 4. 导入技能 (Skill)

技能导入同样通过 AI 工具完成。告诉 AI 工具调用 `skill:import`，然后提供：

- 本地技能路径
- 或暴露 `SKILL.md` 的远程技能根 URL

**本地技能示例**：

```json
{
  "path": "/absolute/path/to/skill"
}
```

**远程技能示例**：

```json
{
  "url": "https://example.com/skill"
}
```

与 MCP 导入一样，技能导入返回 `app id`、`keywords`、`summary` 和 `app:<id>` 引导工具名称。

导入后需重启 AI 工具。

### 5. 支持的 ACP Agents

AAI Gateway 还能通过 ACP 控制类应用的 Agent。

当前支持的 ACP Agent 类型：

- OpenCode
- Claude Code
- Codex

## 原理

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        AI Agent                             │
│                    (Claude Code / Codex / OpenCode)         │
└────────────────────────┬────────────────────────────────────┘
                         │  One MCP Connection
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                      AAI Gateway                            │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Progressive Disclosure Layer               ││
│  │  - App-level exposure (not tool-level)                  ││
│  │  - Summary / Keywords modes                              ││
│  │  - Lazy tool loading on demand                          ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │                   App Registry                           ││
│  │  - MCP Servers    - Skills                               ││
│  │  - ACP Agents     - CLI Tools                           ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │                  Discovery Layer                         ││
│  │  - Desktop Descriptors  - Web Descriptors               ││
│  │  - Gateway Imports       - Built-in Descriptors          ││
│  └─────────────────────────────────────────────────────────┘│
└────────────────────────┬────────────────────────────────────┘
                         │  Native Protocol
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    External Apps                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │   MCP    │ │  Skill   │ │   ACP    │ │   CLI    │       │
│  │ Servers  │ │          │ │  Agents  │ │  Tools   │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### 统一抽象：Agent App

AAI Gateway 将 MCP、技能、ACP Agent、CLI 工具统一抽象为 **Agent App**。

只要提供一个 App 的描述文件 (`aai.json`)，即可接入 AAI Gateway。描述文件告诉 AAI Gateway：

- App 是什么
- 如何连接
- 如何以低上下文成本暴露

### 描述文件示例

#### MCP Server 描述文件

```json
{
  "schemaVersion": "2.0",
  "version": "1.0.0",
  "app": {
    "name": {
      "default": "Filesystem Server"
    }
  },
  "access": {
    "protocol": "mcp",
    "config": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    }
  },
  "exposure": {
    "keywords": ["file", "filesystem", "read", "write"],
    "summary": "Use this app when the user wants to read from or write to the local filesystem."
  }
}
```

#### Skill 描述文件

```json
{
  "schemaVersion": "2.0",
  "version": "1.0.0",
  "app": {
    "name": {
      "default": "Git Commit Skill"
    }
  },
  "access": {
    "protocol": "skill",
    "config": {
      "url": "https://github.com/example/git-commit-skill"
    }
  },
  "exposure": {
    "keywords": ["git", "commit", "version control"],
    "summary": "Use this app when the user wants to create git commits with auto-generated messages."
  }
}
```

#### ACP Agent 描述文件

```json
{
  "schemaVersion": "2.0",
  "version": "1.0.0",
  "app": {
    "name": {
      "default": "Claude Code"
    }
  },
  "access": {
    "protocol": "acp-agent",
    "config": {
      "agentType": "claude-code"
    }
  },
  "exposure": {
    "keywords": ["claude", "code", "coding", "agent"],
    "summary": "Use this app when the user wants Claude Code to perform coding tasks."
  }
}
```

#### CLI 工具描述文件

```json
{
  "schemaVersion": "2.0",
  "version": "1.0.0",
  "app": {
    "name": {
      "default": "Example CLI"
    }
  },
  "access": {
    "protocol": "cli",
    "config": {
      "command": "example-app"
    }
  },
  "exposure": {
    "keywords": ["example", "utility"],
    "summary": "Use this app when the user wants to work with Example App."
  }
}
```

## 如何将更多 App 预置集成到 AAI Gateway

### 提交 Pull Request

如果你希望 AAI Gateway 默认打包某个 App 的描述文件，可以提交 PR。

PR 需要包含：

1. 描述文件本身
2. 安全的发现规则（证明 App 确实已安装）
3. 连接配置
4. 说明为什么这个集成应该被捆绑

内置 ACP Agent 描述文件位于：

- `src/discovery/descriptors/`

它们在以下文件中注册：

- `src/discovery/agent-registry.ts`

标准 PR 流程：

1. 添加描述文件
2. 添加或更新发现检查
3. 在适当的发现源中注册
4. 如果新集成面向用户，更新 README

如果你不确定某个集成是否应该被捆绑，请先提交 Issue 讨论。

### 描述文件放置位置

AAI Gateway 从以下位置发现 App：

#### Web Apps

发布到：

```
https://<your-host>/.well-known/aai.json
```

用户调用 `remote:discover` 时，AAI Gateway 会获取该路径。

#### macOS Apps

推荐位置：

- `<YourApp>.app/Contents/Resources/aai.json`
- `~/Library/Containers/<container>/Data/Library/Application Support/aai.json`
- `~/Library/Containers/<container>/Data/Library/Application Support/aai-gateway/aai.json`

#### Linux Apps

扫描以下位置：

- `/usr/share`
- `/usr/local/share`
- `~/.local/share`

#### Windows Apps

扫描以下位置：

- `C:\Program Files`
- `C:\Program Files (x86)`
- `%LOCALAPPDATA%`

#### 描述文件编写建议

- 保持描述文件小而实用
- `app.name.default` 要清晰
- `keywords` 要短且高信号
- `summary` 要解释何时应该使用该 App
- 详细能力数据放在下游协议中，而非描述文件中
- 如果你的 App 已使用 MCP，保持描述文件最小化，让 MCP 提供惰性工具详情

## Disclaimer

AAI Gateway is still under active development.

You should expect rough edges, missing pieces, and bugs.

Contributions are welcome.
