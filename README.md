# AAI Gateway

## One MCP. Many Apps. Less Context.

AAI Gateway turns many apps, agents, skills, and MCP servers into one MCP server.

You connect your AI tool once. AAI Gateway handles discovery, import, routing, and exposure control behind that single entrypoint.

Why this matters:

- One MCP connection instead of one MCP per app
- Smaller context because tools are exposed at the app level first, not dumped all at once
- A cleaner path to mix MCP servers, skills, ACP agents, and CLI-backed apps

AAI Gateway is for one goal: make tool ecosystems feel smaller, sharper, and easier for agents to use.

## How To Use

### 1. Connect Your AI Tool To AAI Gateway

Examples below assume `aai-gateway` is already on your `PATH`.

If you run from source, build first with:

```bash
npm install
npm run build
```

Then replace `aai-gateway` in the examples with:

```bash
node /absolute/path/to/aai-gateway/dist/cli.js
```

### Claude Code

Official docs: <https://code.claude.com/docs/en/mcp>

```bash
claude mcp add --transport stdio aai-gateway -- aai-gateway
```

### Codex

Official docs: <https://developers.openai.com/learn/docs-mcp>

```bash
codex mcp add aai-gateway -- aai-gateway
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
      "command": ["aai-gateway"],
      "enabled": true
    }
  }
}
```

### What You Get After Connecting

Once connected, your AI tool can use AAI Gateway tools such as:

- `remote:discover`
- `aai:exec`
- `mcp:import`
- `skill:import`
- `mcp:refresh`
- `import:config`

### 2. Import An MCP Server

You can import through the AI tool or through the CLI.

AI tools should call `mcp:import` and ask the user to choose an exposure mode first:

- `summary`: easier automatic triggering
- `keywords`: leaves room for more tools, but usually needs more explicit keyword mentions

CLI examples:

Local stdio MCP:

```bash
aai-gateway mcp import \
  --command npx \
  --arg -y \
  --arg @modelcontextprotocol/server-filesystem \
  --arg /tmp \
  --exposure summary
```

Remote Streamable HTTP MCP:

```bash
aai-gateway mcp import \
  --url https://example.com/mcp \
  --transport streamable-http \
  --exposure summary
```

Remote SSE MCP:

```bash
aai-gateway mcp import \
  --url https://example.com/sse \
  --transport sse \
  --exposure keywords
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

### 3. Import A Skill

Skills are imported app wrappers around `SKILL.md`.

Local skill:

```bash
aai-gateway skill import \
  --path /absolute/path/to/skill \
  --exposure summary
```

Remote skill:

```bash
aai-gateway skill import \
  --url https://example.com/skill \
  --exposure keywords
```

Just like MCP import, skill import returns:

- the generated app id
- generated `keywords`
- generated `summary`
- the guide tool name: `app:<id>`

Then restart your AI tool before using the imported skill.

### 4. Update Exposure Later

If the generated metadata is not right, update it later without re-importing.

From the AI tool:

- call `import:config`
- pass either `app: "app:<id>"` or `localId: "<id>"`
- optionally update `exposure`, `keywords`, and `summary`

From the CLI:

```bash
aai-gateway app config server-filesystem \
  --exposure keywords \
  --keyword filesystem \
  --keyword file \
  --summary "Use this app for local file reads, writes, listing, and search."
```

Then restart your AI tool before using the updated metadata.

### 5. Built-In ACP Agent Support

AAI Gateway currently auto-discovers these ACP agents when they are installed:

- OpenCode via `opencode acp`
- Claude Code via `npx -y @zed-industries/claude-agent-acp`
- Codex via `npx -y @zed-industries/codex-acp`

These agents are exposed through AAI Gateway as normal apps and can be invoked through `aai:exec`.

## Discovery For App Developers

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
