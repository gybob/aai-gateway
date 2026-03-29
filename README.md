# AAI Gateway

## Why AAI Gateway

AAI stands for **Agent App Interface**.

### Three Pain Points of MCP/Skill Configuration

**1. Context Token Waste**: Every MCP server injects its schema, descriptions, and tool lists into the prompt. As you add more servers, the model spends more tokens understanding tools than executing tasks.

**2. Config Cannot Be Shared Across Agents**: MCP/Skill configured in Claude Code cannot be directly used in OpenCode or Codex. You have to configure it separately for each agent tool.

**3. Requires Agent Restart After Installation**: Traditionally, adding a new MCP or Skill requires restarting the agent tool to take effect.

### What AAI Gateway Solves

- **Progressive Disclosure**: Expose app overview first, reveal tool details only when needed, avoiding context explosion
- **Centralized Config Management**: Import MCP/Skill once, share across all agent tools
- **Hot Loading**: Auto-notify agents after import, **no restart required**
- **Natural Language Interaction**: Search, import, and manage MCPs/Skills through simple conversation

AAI Gateway unifies MCP servers, Skills, ACP agents, and CLI tools under one roof, making it simple and efficient for agents to discover and use software.

## How To Use

### 1. Install AAI Gateway MCP

You do not need to preinstall `aai-gateway`. Simply register it as a user-level MCP server and launch it via `npx`.

#### Claude Code

```bash
claude mcp add --scope user --transport stdio aai-gateway -- npx -y aai-gateway
```

#### Codex

```bash
codex mcp add aai-gateway -- npx -y aai-gateway
```

#### OpenCode

Add to `~/.config/opencode/opencode.json`:

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

### 2. Search and Install MCP or Skill

If you don't know which MCP or skill to install, just ask your AI tool to search for what you need using AAI Gateway (e.g., "please search for a filesystem MCP" or "find me a git commit skill").

The search will:

- Convert your request into search keywords
- Recommend safer authoritative sources to search first
- Normalize search results into a shortlist for your confirmation
- Route confirmed items into the import flow

**Recommended Search Source Order**:

1. Official catalogs: `modelcontextprotocol/registry`, `modelcontextprotocol/servers`, `openai/skills`
2. Community-curated lists: `punkpeye/awesome-mcp-servers`, `ComposioHQ/awesome-claude-skills`
3. Higher-scrutiny sources: Open marketplaces like ClawHub (use with extra caution)

> Note: The recommended list is a starting point, not a hard allowlist. Do not casually suggest tools from unknown websites. For marketplace platforms, also verify the maintainer's identity, repository activity, README quality, and license visibility.

### 3. Import an MCP Server

Main workflow: Copy a mainstream MCP config snippet into your AI tool and ask it to import that server through AAI Gateway.

The AI tool will:

1. Read the MCP config you pasted
2. Inspect the downstream MCP tools through AAI Gateway
3. Summarize when the MCP should be used
4. Ask whether it should be enabled for the current agent only or for all agents
5. Call `mcp:import`

AAI Gateway keeps import parameters consistent with standard MCP config shapes:

- stdio MCP: `command`, `args`, `env`, `cwd`
- remote MCP: `url`, optional `transport`, optional `headers`

**stdio MCP Example**:

```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
}
```

**Remote Streamable HTTP MCP Example**:

```json
{
  "url": "https://example.com/mcp"
}
```

**Remote SSE MCP Example**:

```json
{
  "url": "https://example.com/sse",
  "transport": "sse"
}
```

After import, AAI Gateway returns:

- The generated app id
- The generated `summary`
- The guide tool name: `app:<id>`

> AAI Gateway sends `tools/listChanged` after import. Clients that implement this notification can pick up new tools without restart.

### 4. Import a Skill

Skills are imported through the AI tool as well. Tell the AI tool to import a skill using AAI Gateway, then provide:

- A local skill path

If the skill is remote, download and extract the whole skill directory first. AAI Gateway only imports from a local directory and copies the full directory into managed storage.

**Local Skill Example**:

```json
{
  "path": "/absolute/path/to/skill"
}
```

AAI Gateway derives the imported skill summary from the skill's own `SKILL.md` description. It can also generate a lightweight proxy `SKILL.md` for the current agent so the agent can discover the skill automatically.

### 5. Supported ACP Agents

AAI Gateway can also control app-like agents through ACP.

Currently supported ACP agent types:

- OpenCode
- Claude Code
- Codex

## How It Works

### Architecture

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
│  │  - Summary-only disclosure                               ││
│  │  - Lazy tool loading on demand                          ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │                   App Registry                           ││
│  │  - MCP Servers    - Skills                               ││
│  │  - ACP Agents     - CLI Tools                           ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │                  Discovery Layer                         ││
│  │  - Desktop Descriptors  - Managed Imports                ││
│  │  - Built-in Descriptors                                   ││
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

### Unified Abstraction: Agent App

AAI Gateway unifies MCPs, Skills, ACP Agents, and CLI tools into **Agent Apps**.

To integrate an app with AAI Gateway, simply provide an app descriptor file (`aai.json`). The descriptor tells AAI Gateway:

- What the app is
- How to connect to it
- How to expose it at low context cost

### Descriptor Examples

#### MCP Server Descriptor

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
    "summary": "Use this app when the user wants to read from or write to the local filesystem."
  }
}
```

#### Skill Descriptor

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
      "path": "/absolute/path/to/git-commit-skill"
    }
  },
  "exposure": {
    "summary": "Use this app when the user wants to create git commits with auto-generated messages."
  }
}
```

#### ACP Agent Descriptor

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
    "summary": "Use this app when the user wants Claude Code to perform coding tasks."
  }
}
```

#### CLI Tool Descriptor

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
    "summary": "Use this app when the user wants to work with Example App."
  }
}
```

## Pre-bundling Apps in AAI Gateway

### Submit a Pull Request

If you want AAI Gateway to ship with a descriptor for an app by default, open a PR.

A PR should include:

1. The descriptor itself
2. A safe discovery rule that proves the app is actually installed
3. The connection config
4. An explanation of why the integration should be bundled

Built-in ACP agent descriptors live in:

- `src/discovery/descriptors/`

They are registered in:

- `src/discovery/agent-registry.ts`

Standard PR workflow:

1. Add the descriptor file
2. Add or update discovery checks
3. Register it in the appropriate discovery source
4. Update the README if the new integration is user-facing

If you're unsure whether an integration should be bundled, open an issue first to discuss.

### Where to Place Descriptors

AAI Gateway discovers apps from the following locations:

#### macOS Apps

Recommended locations:

- `<YourApp>.app/Contents/Resources/aai.json`
- `~/Library/Containers/<container>/Data/Library/Application Support/aai.json`
- `~/Library/Containers/<container>/Data/Library/Application Support/aai-gateway/aai.json`

#### Linux Apps

Scanned locations:

- `/usr/share`
- `/usr/local/share`
- `~/.local/share`

#### Windows Apps

Scanned locations:

- `C:\Program Files`
- `C:\Program Files (x86)`
- `%LOCALAPPDATA%`

#### Descriptor Guidelines

- Keep descriptors small and practical
- Make `app.name.default` clear
- Make `summary` explain when the app should be used
- Put detailed capability data in the downstream protocol, not in the descriptor
- If your app already speaks MCP, keep the descriptor minimal and let MCP provide lazy tool details

## Disclaimer

AAI Gateway is still under active development.

You should expect rough edges, missing pieces, and bugs.

Contributions are welcome.
