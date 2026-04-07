[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

---

# AAI Gateway: Unified MCP & Skill Management, Shared Across AI Agents, 99% Context Token Savings

[![npm version](https://img.shields.io/npm/v/aai-gateway)](https://www.npmjs.com/package/aai-gateway)
[![license](https://img.shields.io/npm/l/aai-gateway)](./LICENSE)

---

## What Is It

**AAI** = **Agent App Interface**

AAI Gateway is the interaction gateway for Agent Apps.

What is an **Agent App**? An Agent App is a collection of capabilities that an Agent can use. For example:

- An **MCP Server** is an Agent App — it provides a set of tools
- A **Skill package** is an Agent App — it provides one or more skills

In AAI Gateway, they are abstracted as **Agent Apps** under unified management. Import once, and all AI Agents can use them immediately.

---

## What Problems Does It Solve

### Context Bloat

Traditional: 10 MCPs × 5 tools = **50 full schemas ≈ 7,500 tokens** injected into every conversation.

AAI Gateway: each Agent App needs only **fewer than 50 tokens for a summary**, with details loaded on demand. **99% token savings.**

### Finding Tools Is Hard

Traditional: search GitHub → read READMEs → copy JSON configs → debug connections → restart Agent.

AAI Gateway: **say one sentence, Agent auto-searches, installs, and it's ready**.

> "I want to make a company introduction PPT"
>
> → Agent finds PPT skill missing → auto-searches and installs PPT Skill → guides you through creation, no restart needed

> "Help me scrape this webpage"
>
> → Agent finds web scraping tool missing → auto-searches and installs the MCP → scrapes directly, no restart needed

### Duplicate Config

Configure the same thing in Claude Code, Codex, and OpenCode separately? Import once through AAI Gateway, all Agents share instantly.

---

## Quick Start (30 Seconds)

**Claude Code:**

```bash
claude mcp add --scope user --transport stdio aai-gateway -- npx -y aai-gateway
```

**Codex:**

```bash
codex mcp add aai-gateway -- npx -y aai-gateway
```

**OpenCode** — add to `~/.config/opencode/opencode.json`:

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

Once installed, just tell your Agent what you want to do.

---

## Built-in Tools

| Tool | Description |
|------|-------------|
| `search:discover` | Search and install new tools with natural language |
| `mcp:import` | Import an MCP Server as an Agent App |
| `skill:import` | Import a Skill package as an Agent App |
| `listAllAaiApps` | List all registered Agent Apps |
| `enableApp` / `disableApp` | Enable or disable an Agent App per Agent |
| `removeApp` | Remove an Agent App |
| `aai:exec` | Execute a specific tool within an Agent App |

Each imported Agent App generates an **`app_<app-id>`** tool that returns the full operation guide and tool list when called.

### Preset Agent Apps (auto-discovered when locally installed)

| App ID | Name | Description |
|--------|------|-------------|
| `claude` | Claude Code | AI coding assistant for code editing, analysis, and development |
| `codex` | Codex | OpenAI-powered AI coding assistant |
| `opencode` | OpenCode | AI development assistant for editing files and running commands |

---

## Architecture

![Architecture](images/architecture.png)

---

## Developers: Get Your Agent App Auto-Discovered

Create an `aai.json` descriptor and submit it to `src/discovery/descriptors/`. When a user's local environment meets the `discovery.checks` conditions, the Agent will auto-discover your Agent App.

```json
{
  "schemaVersion": "2.0",
  "version": "1.0.0",
  "app": {
    "name": { "default": "My App" }
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
    "summary": "Use when the user wants to do X."
  }
}
```

`discovery.checks` supports three check types: `command` (command exists), `file` (file exists), `path` (directory exists).

Supported protocols: `mcp`, `skill`, `acp-agent`

Welcome to [submit a PR](../../pulls) to contribute new Agent App descriptors, or [open an issue](../../issues) for feedback.
