# AAI Gateway

## One MCP. Many Apps. Less Context.

AAI Gateway turns many apps, agents, skills, and MCP servers into one MCP server.

You connect your AI tool once. AAI Gateway handles discovery, import, routing, and exposure control behind that single entrypoint.

Why this matters:

- One MCP connection instead of one MCP per app
- Smaller context through progressive disclosure — AAI Gateway never exposes raw tool definitions upfront

  **App-level exposure, not tool-level.** Tools are grouped into apps and only the app interface is visible initially. Users interact through `app:<id>` guides instead of seeing dozens of individual tools.

  **Two app interfaces, user chooses:**
  - `summary` — a natural language description; good for automatic triggering
  - `keywords` — a compact keyword set; further reduces context overhead when users reference tools explicitly

  Both modes keep the full tool capability available downstream — it just stays hidden until actually needed.

- A cleaner path to mix MCP servers, skills, ACP agents, and CLI-backed apps

AAI Gateway is for one goal: make tool ecosystems feel smaller, sharper, and easier for agents to use.

## How To Use

### 1. Connect Your AI Tool To AAI Gateway

You do not need to preinstall `aai-gateway`.

Use the same style users already know from mainstream MCP setups: launch it through `npx`.

### Claude Code

Official docs: <https://code.claude.com/docs/en/mcp>

```bash
claude mcp add --transport stdio aai-gateway -- npx -y aai-gateway
```

### Codex

Official docs: <https://developers.openai.com/learn/docs-mcp>

```bash
codex mcp add aai-gateway -- npx -y aai-gateway
```

### OpenCode

Official docs: <https://opencode.ai/docs/config> and <https://opencode.ai/docs/mcp-servers/>

Add this to `~/.config/opencode/opencode.json` or your project `opencode.json`:

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

### What You Get After Connecting

Once connected, your AI tool can use AAI Gateway tools such as:

- `remote:discover`
- `aai:exec`
- `import:search`
- `mcp:import`
- `skill:import`
- `mcp:refresh`
- `import:config`

`import:search` also has a compatibility alias: `ability_search`.

### 2. Search For MCP Servers Or Skills

If you do not already know which MCP server or skill to install, ask the AI tool to call `import:search` first.

This tool does not perform the web search for you. Instead, it:

- turns the user request into search keywords
- recommends safer mainstream sources to search first
- normalizes the agent's gathered results into a shortlist
- gives each shortlist item a temporary id for user confirmation
- routes confirmed items into existing `mcp:import` or `skill:import` flows

Recommended source order:

- Official catalogs first:
  - `modelcontextprotocol/registry`
  - `modelcontextprotocol/servers`
  - `openai/skills`
- Community-curated GitHub lists second:
  - `punkpeye/awesome-mcp-servers`
  - `ComposioHQ/awesome-claude-skills`
- Higher-scrutiny sources:
  - open marketplaces such as ClawHub

Important:

- The recommended list is a preferred starting point, not a hard allowlist.
- Do not casually suggest tools from random small websites.
- Outside the preferred list, inspect maintainer identity, repository activity, README quality, license visibility, and whether the source actually exposes an importable MCP config or real skill root.
- Open marketplaces such as ClawHub should be treated with extra caution. They are not default-trust sources.

If the AI tool does not already have a retrieval tool, it can first import a fetch MCP through AAI Gateway, for example:

```json
{
  "command": "npx",
  "args": ["-y", "mcp-fetch-server"]
}
```

### 3. Import An MCP Server

The main workflow is: copy a mainstream MCP config snippet into your AI tool and ask it to import that server through AAI Gateway.

The AI tool should:

1. read the MCP config you pasted
2. ask you to choose an exposure mode
3. call `mcp:import`

AAI Gateway keeps the import parameters close to normal MCP config shapes:

- stdio MCP: `command`, `args`, `env`, `cwd`
- remote MCP: `url`, optional `transport`, optional `headers`

Before import, the AI tool should ask you to choose:

- `summary`: easier automatic triggering
- `keywords`: leaves room for more tools, but usually needs more explicit keyword mentions

Example: import a normal stdio MCP config

```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
}
```

Example: import a normal remote Streamable HTTP MCP config

```json
{
  "url": "https://example.com/mcp"
}
```

Example: import a normal remote SSE MCP config

```json
{
  "url": "https://example.com/sse",
  "transport": "sse"
}
```

After import, AAI Gateway returns:

- the generated app id
- the generated `keywords`
- the generated `summary`
- the guide tool name: `app:<id>`

Important:

- Restart your AI tool before using the newly imported tool.
- After restart, the imported app will appear as `app:<id>`.
- Use `aai:exec` to actually run the imported app’s operations.

### 4. Import A Skill

Skills are imported through the AI tool as well.

Ask the AI tool to call `skill:import`, then give it either:

- a local skill path
- a remote skill root URL that exposes `SKILL.md`

Examples:

```json
{
  "path": "/absolute/path/to/skill"
}
```

```json
{
  "url": "https://example.com/skill"
}
```

Just like MCP import, skill import returns:

- the generated app id
- generated `keywords`
- generated `summary`
- the guide tool name: `app:<id>`

Then restart your AI tool before using the imported skill.

### 5. Supported ACP Agents

AAI Gateway can also control app-like agents through ACP.

Currently supported ACP agent types:

- OpenCode
- Claude Code
- Codex

## App Auto Discovery

AAI Gateway discovers apps from four places:

- desktop descriptors
- web descriptors
- gateway-managed imports
- built-in ACP agent descriptors

### The AAI Descriptor

The descriptor is a small `aai.json` file. It tells AAI Gateway:

- what the app is
- how to connect to it
- how to expose it at low context cost

Minimal example:

```json
{
  "schemaVersion": "2.0",
  "version": "1.0.0",
  "app": {
    "name": {
      "default": "Example App"
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

Supported `access.protocol` values today:

- `mcp`
- `skill`
- `acp-agent`
- `cli`

### Where To Put `aai.json`

#### Web Apps

Publish it at:

```text
https://<your-host>/.well-known/aai.json
```

AAI Gateway fetches that path when the user calls `remote:discover`.

#### macOS Apps

Recommended locations scanned by the gateway:

- `<YourApp>.app/Contents/Resources/aai.json`
- `~/Library/Containers/<container>/Data/Library/Application Support/aai.json`
- `~/Library/Containers/<container>/Data/Library/Application Support/aai-gateway/aai.json`

#### Linux Apps

The gateway scans for `aai.json` under:

- `/usr/share`
- `/usr/local/share`
- `~/.local/share`

#### Windows Apps

The gateway scans for `aai.json` under:

- `C:\Program Files`
- `C:\Program Files (x86)`
- `%LOCALAPPDATA%`

### Descriptor Guidelines

Keep descriptors small and practical:

- make `app.name.default` clear
- keep `keywords` short and high-signal
- make `summary` explain when the app should be used
- put detailed capability data in the downstream protocol, not in the descriptor

If your app already speaks MCP, keep the descriptor minimal and let MCP provide tool detail lazily.

## Submit A Pull Request To Preload A Descriptor

If you want AAI Gateway to ship with a descriptor by default, open a PR.

What to include:

- the descriptor itself
- a safe discovery rule that proves the app is actually installed
- the connection config
- a short explanation of why the integration should be bundled

Today, built-in ACP agent descriptors live in:

- `src/discovery/descriptors/`

And they are registered in:

- `src/discovery/agent-registry.ts`

For a typical PR:

1. Add the descriptor file.
2. Add or update discovery checks.
3. Register it in the appropriate discovery source.
4. Update the README if the new integration is user-facing.

If you are unsure whether an integration should be bundled, open an issue first.

## Disclaimer

AAI Gateway is still under active development.

You should expect rough edges, missing pieces, and bugs.

Contributions are welcome.
