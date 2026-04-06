[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

---

# AAI Gateway — One MCP to Rule Them All

**Install MCP servers and skills once, share across all your AI agents. No restart. No context explosion. Just ask.**

[![npm version](https://img.shields.io/npm/v/aai-gateway)](https://www.npmjs.com/package/aai-gateway)
[![license](https://img.shields.io/npm/l/aai-gateway)](./LICENSE)

<!-- TODO: Add a GIF demo here showing: search → confirm → install → use across agents -->

---

## The Problem

As the MCP ecosystem grows, every AI agent user hits the same wall:

| Pain Point                | What Happens                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Context explosion**     | 10 MCP servers × 5 tools each = 50 full tool schemas injected into every prompt, burning thousands of tokens before the model even starts thinking |
| **Duplicate config**      | Claude Code, Codex, OpenCode — configure the same MCP server three times, keep them in sync manually                                               |
| **Restart required**      | Add a new MCP? Restart your agent. Every. Single. Time.                                                                                            |
| **Finding tools is hard** | Search GitHub, read READMEs, copy JSON configs, debug connection errors — all before you can even try a tool                                       |

## The Solution

AAI Gateway sits between your AI agents and all your tools. One MCP connection replaces dozens.

|                  | Without AAI Gateway             | With AAI Gateway                                                  |
| ---------------- | ------------------------------- | ----------------------------------------------------------------- |
| **Context cost** | 50 tool schemas in every prompt | 10 one-line summaries (~200 chars each), details loaded on demand |
| **Config**       | Configure each MCP per agent    | Import once, all agents share instantly                           |
| **New tools**    | Restart agent after install     | Hot-reload, available immediately                                 |
| **Discovery**    | Manual search + copy config     | `"Find me a filesystem MCP"` → installed in seconds               |

---

## Quick Start (30 seconds)

### 1. Add AAI Gateway to your agent

**Claude Code**

```bash
claude mcp add --scope user --transport stdio aai-gateway -- npx -y aai-gateway
```

**Codex**

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

### 2. Start using it

Just talk to your AI agent:

> "Help me search for a filesystem MCP and install it"

> "Import this MCP: `npx -y @anthropic-ai/mcp-server-fetch`"

> "What tools do I have installed?"

That's it. No config files to edit, no agent restarts needed.

---

## How It Works: Two-Stage Disclosure

This is the core innovation. Instead of dumping all tool schemas into the prompt, AAI Gateway uses **progressive disclosure**:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Stage 1 — What the agent sees in its tool list                    │
│                                                                     │
│  guide:filesystem    "Read/write local files and directories"       │ ~50 chars
│  guide:github        "Manage GitHub repos, issues, and PRs"        │ ~50 chars
│  guide:slack         "Send messages and manage Slack channels"      │ ~50 chars
│  ... (one line per app, no parameter schemas)                       │
├─────────────────────────────────────────────────────────────────────┤
│  Stage 2 — Agent decides to use filesystem                         │
│                                                                     │
│  → Calls guide:filesystem                                           │
│  ← Gets full tool list + parameter schemas + usage examples        │
│  → Executes via aai:exec { app, tool, args }                       │
└─────────────────────────────────────────────────────────────────────┘
```

**The math**: 10 MCP servers with 5 tools each = **50 full schemas** in traditional setup. With AAI Gateway = **10 short summaries** + details loaded only when needed. Context savings of **90%+**.

---

## Key Features

### Search & Install with Natural Language

Describe what you need, and AAI Gateway finds it for you. It searches trusted sources (official MCP registries, curated lists), presents options, and handles the entire import flow.

> "Find me an MCP for database queries" → search → select → imported → ready

### Import Any MCP Server

Paste any standard MCP config and ask your agent to import it through AAI Gateway.

**stdio MCP:**

```json
{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] }
```

**Remote (Streamable HTTP):**

```json
{ "url": "https://example.com/mcp" }
```

**Remote (SSE):**

```json
{ "url": "https://example.com/sse", "transport": "sse" }
```

### Import Skills

Import local or remote skill packages. AAI Gateway copies them into managed storage and exposes them as tools. Future updates: automatic skill updates from remote sources — solving the pain point where skill authors can't push updates to users.

```json
{ "path": "/path/to/my-skill" }
```

### Agent Interoperability (ACP)

AAI Gateway auto-detects installed agent tools (Claude Code, Codex, OpenCode) and exposes them as controllable apps. This means:

- Use **one agent to orchestrate another** — e.g., direct Claude Code to write code while you review from a different tool
- **Remote work** — instruct your coding agents from your phone while on the go

### Per-Agent Control

One import serves all agents, but you can fine-tune visibility:

- `enableApp` / `disableApp` — toggle tools per agent
- `removeApp` — uninstall completely
- `listAllAaiApps` — see everything that's registered

### Auto-Discovery

Apps can register themselves by placing an `aai.json` descriptor at a known location. AAI Gateway scans these locations automatically:

- **macOS**: `<App>.app/Contents/Resources/aai.json`
- **Linux**: `/usr/share`, `/usr/local/share`, `~/.local/share`
- **Windows**: `Program Files`, `%LOCALAPPDATA%`

No manual import needed — install the app, and AAI Gateway finds it.

---

## Built-in Tools

| Tool              | Description                                                          |
| ----------------- | -------------------------------------------------------------------- |
| `listAllAaiApps`  | List all apps managed by AAI Gateway                                 |
| `enableApp`       | Enable an app for the current agent                                  |
| `disableApp`      | Disable an app for the current agent                                 |
| `removeApp`       | Remove an app from the system                                        |
| `aai:exec`        | Execute a specific tool from a managed app (`app` + `tool` + `args`) |
| `mcp:import`      | Import an MCP server                                                 |
| `skill:import`    | Import a skill package                                               |
| `skill:create`    | Create a new skill                                                   |
| `search:discover` | Search for new tools or skills with natural language                 |

Plus a **`guide:<app-id>`** tool for each imported app — no parameters, just returns the full operation guide when called.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      AI Agents                              │
│           Claude Code  /  Codex  /  OpenCode  / ...         │
└────────────────────────┬────────────────────────────────────┘
                         │  Single MCP Connection
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                      AAI Gateway                            │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │            Progressive Disclosure Layer               │  │
│  │  summary-only exposure → on-demand tool details       │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                  App Registry                         │  │
│  │   MCP Servers · Skills · ACP Agents · CLI Tools      │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │               Discovery Layer                         │  │
│  │   Desktop scan · Managed imports · Built-in configs   │  │
│  └───────────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
     ┌──────────┐ ┌──────────┐ ┌──────────┐
     │   MCP    │ │  Skills  │ │   ACP    │ ...
     │ Servers  │ │          │ │  Agents  │
     └──────────┘ └──────────┘ └──────────┘
```

---

## Use Cases

### "I have 15 MCPs and my context is exploding"

AAI Gateway's two-stage disclosure cuts context token usage by 90%+. Your agent sees short summaries, not 15 full tool schemas.

### "I use Claude Code AND OpenCode"

Import once through AAI Gateway. Both agents see the same tools immediately. Add Codex tomorrow — it gets them too, zero extra config.

### "I want to write code while drinking tea"

Set up ACP agents. Use any agent (even on your phone) to instruct Claude Code or Codex to write, test, and commit code on your workstation.

### "I don't know which MCP to use"

Just describe what you need: `"I need something to query PostgreSQL"`. AAI Gateway searches trusted registries and handles the entire installation.

---

## For App Developers: AAI Descriptor

Want your app to be auto-discovered by AAI Gateway? Add an `aai.json` descriptor:

```json
{
  "schemaVersion": "2.0",
  "version": "1.0.0",
  "app": {
    "name": { "default": "My App" }
  },
  "access": {
    "protocol": "mcp",
    "config": {
      "command": "my-app-mcp",
      "args": ["--stdio"]
    }
  },
  "exposure": {
    "summary": "Use this when the user wants to do X with My App."
  }
}
```

Supported protocols: `mcp`, `skill`, `acp-agent`, `cli`

Place the descriptor at one of the [auto-discovery locations](#auto-discovery), and AAI Gateway picks it up automatically.

Want to bundle your descriptor with AAI Gateway by default? [Open a PR](../../pulls) — see `src/discovery/descriptors/` for examples.

---

## Contributing

Contributions are welcome! AAI Gateway is under active development.

- [Open an issue](../../issues) to report bugs or suggest features
- [Submit a PR](../../pulls) to contribute code or new app descriptors
