# AAI Gateway

## One MCP. Many Apps. Less Context.

AAI Gateway turns many apps, agents, skills, and MCP servers into one MCP server.

## Core Values

### Value 1: Natural Language-Driven Tool Integration

After installing the AAI Gateway MCP, you can quickly integrate any other MCP or skill through natural language descriptions, and control other AI Agent tools (including Claude Code, Codex, OpenCode, etc.).

AAI Gateway also integrates a search tool that helps you search for official and secure MCPs and skills from authoritative, mainstream websites, and install them with a single sentence. Control of other AI Agent tools is done via Agent Client Protocol (ACP), including session management.

### Value 2: Progressive Disclosure Strategy

AAI Gateway does not dump all tool descriptions into the LLM context at once. Instead, it employs a progressive disclosure strategy:

**MCP Server Level**: Only the overall description of the MCP Server is exposed initially. When the LLM determines that a specific tool needs to be used, it returns tool usage guidance first. The Agent then calls the unified `aai:exec` to execute based on that guidance. `aai:exec` accepts `appId`, `tool`, and `tool args` as parameters.

**MCP / Skill Description Level**: Two tiers of disclosure are provided:

- `summary` — Natural language description; good for automatic triggering
- `keywords` — Compact keyword set; further reduces context overhead

This allows OpenClaw (a popular personal assistant application) and similar tools that require many tools and skills to still run smoothly.

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
2. Ask you to choose an exposure mode
3. Call `mcp:import`

AAI Gateway keeps import parameters consistent with standard MCP config shapes:

- stdio MCP: `command`, `args`, `env`, `cwd`
- remote MCP: `url`, optional `transport`, optional `headers`

Choose an exposure mode before import:

- `summary`: Easier automatic triggering
- `keywords`: Leaves room for more tools, but usually needs more explicit keyword mentions

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
- The generated `keywords`
- The generated `summary`
- The guide tool name: `app:<id>`

> **Important**: Restart your AI tool before using the newly imported tool. After restart, the imported app will appear as `app:<id>`. Use `aai:exec` to actually run the imported app's operations.

### 4. Import a Skill

Skills are imported through the AI tool as well. Just tell the AI tool to import a skill using AAI Gateway, then provide either:

- A local skill path
- A remote skill root URL that exposes `SKILL.md`

**Local Skill Example**:

```json
{
  "path": "/absolute/path/to/skill"
}
```

**Remote Skill Example**:

```json
{
  "url": "https://example.com/skill"
}
```

Like MCP import, skill import returns `app id`, `keywords`, `summary`, and the `app:<id>` guide tool name.

Restart your AI tool after import.

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
    "keywords": ["file", "filesystem", "read", "write"],
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
      "url": "https://github.com/example/git-commit-skill"
    }
  },
  "exposure": {
    "keywords": ["git", "commit", "version control"],
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
    "keywords": ["claude", "code", "coding", "agent"],
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
    "keywords": ["example", "utility"],
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

#### Web Apps

Publish at:

```
https://<your-host>/.well-known/aai.json
```

AAI Gateway fetches this path when the user calls `remote:discover`.

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
- Keep `keywords` short and high-signal
- Make `summary` explain when the app should be used
- Put detailed capability data in the downstream protocol, not in the descriptor
- If your app already speaks MCP, keep the descriptor minimal and let MCP provide lazy tool details

## Disclaimer

AAI Gateway is still under active development.

You should expect rough edges, missing pieces, and bugs.

Contributions are welcome.
