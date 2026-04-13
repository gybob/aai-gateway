[English](README.md) | 简体中文 | [日本語](README.ja.md) | [한국어](README.ko.md)

---

# AAI Gateway：统一管理 MCP 工具和 Skill，跨 AI Agent 共享，上下文 Token 节省 99%

[![npm version](https://img.shields.io/npm/v/aai-gateway)](https://www.npmjs.com/package/aai-gateway)
[![license](https://img.shields.io/npm/l/aai-gateway)](./LICENSE)

---

## 它是什么

**AAI** = **Agent App Interface**

AAI Gateway 是 Agent App 的交互网关。

什么是 **Agent App**？Agent App 是 Agent 可以使用的能力集合。例如：

- 一个 **MCP Server** 就是一个 Agent App —— 它提供一组工具
- 一个 **Skill 技能包** 也是一个 Agent App —— 它提供一项或多项技能

在 AAI Gateway 中，它们被抽象为 **Agent App** 统一管理，一次导入，所有 AI Agent 立即可用。

---

## 它解决什么问题

### Context 膨胀

传统方式：10 个 MCP × 5 个工具 = **50 份完整 schema ≈ 7500 tokens**，每次对话都要注入。

AAI Gateway：每个 Agent App 只需**不到 50 tokens 的摘要**，Agent 需要时再按需加载详情。**Token 节省 99%。**

### 找工具麻烦

传统方式：翻 GitHub → 看 README → 复制 JSON 配置 → 调试连接 → 重启 Agent。

AAI Gateway：**对 Agent 说"用 AAI 搜索 xxx"，自动搜索、安装、立即可用**。

> "用 AAI 搜索一个浏览器操控工具"
>
> → 搜索 → 找到 Playwright MCP → Agent 总结一句话作为 Agent App 摘要 → 安装 → 立即可用，无需重启

> "用 AAI 搜索一个 PPT 制作技能"
>
> → 搜索 → 找到 PPT Skill → 使用技能描述作为 Agent App 摘要 → 安装 → 立即可用，无需重启

### 重复配置

Claude Code、Codex、OpenCode 各配一遍？通过 AAI Gateway 导入一次，所有 Agent 立即共享。

---

## 快速开始（30 秒）

**Claude Code：**

```bash
claude mcp add --scope user --transport stdio aai-gateway -- npx -y aai-gateway
```

**Codex：**

```bash
codex mcp add aai-gateway -- npx -y aai-gateway
```

**OpenCode** — 添加到 `~/.config/opencode/opencode.json`：

```json
{
  "mcp": {
    "aai-gateway": {
      "type": "local",
      "command": ["npx", "-y", "aai-gateway"],
      "enabled": true
    }
  }
}
```

**[OpenClaw](https://openclaw.ai)：**

```bash
openclaw plugins install openclaw-aai-gateway-plugin
```

装好之后，直接对 Agent 说你想做什么就行。

---

## 内置工具

| 工具 | 说明 |
|------|------|
| `search:discover` | 自然语言搜索并安装新工具 |
| `mcp:import` | 导入一个 MCP Server 作为 Agent App |
| `skill:import` | 导入一个 Skill 技能包作为 Agent App |
| `listAllAaiApps` | 列出所有已注册的 Agent App |
| `enableApp` / `disableApp` | 按 Agent 启用或禁用 Agent App |
| `removeApp` | 移除一个 Agent App |
| `aai:exec` | 执行 Agent App 内的具体工具 |

每个已导入的 Agent App 会生成一个 **`app_<app-id>`** 工具，调用时返回完整的操作指南和工具列表。

### 预置 Agent App（本地已安装才会自动发现）

| App ID | 名称 | 说明 |
|--------|------|------|
| `claude` | Claude Code | AI 编码助手，代码编辑、分析和开发 |
| `codex` | Codex | OpenAI 驱动的 AI 编码助手 |
| `opencode` | OpenCode | AI 开发助手，编辑文件、运行命令 |

---

## 架构

![架构图](images/architecture.png)

---

## 开发者：让你的 Agent App 被自动发现

创建 `aai.json` 描述文件，提交到 `src/discovery/descriptors/`，用户本地满足 `discovery.checks` 条件时，Agent 会自动发现你的 Agent App。

```json
{
  "schemaVersion": "2.0",
  "version": "1.0.0",
  "app": {
    "name": { "default": "My App", "zh-CN": "我的应用" }
  },
  "discovery": {
    "checks": [
      { "kind": "command", "command": "my-app" }
    ]
  },
  "access": {
    "protocol": "mcp",
    "config": {
      "command": "my-app-mcp",
      "args": ["--stdio"]
    }
  },
  "exposure": {
    "summary": "当用户想要做 X 时使用。"
  }
}
```

`discovery.checks` 支持三种检查：`command`（命令是否存在）、`file`（文件是否存在）、`path`（目录是否存在）。

支持的协议：`mcp`、`skill`、`acp-agent`

欢迎 [提交 PR](../../pulls) 贡献新的 Agent App 描述文件，或 [开 Issue](../../issues) 反馈问题。
