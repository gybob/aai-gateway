# AAI Gateway

Reference implementation of the [AAI Protocol](https://github.com/gybob/aai-protocol) -- an MCP server that enables AI Agents to directly invoke application capabilities through platform-native automation.

## Features

- **MCP Server (stdio)** -- connects to any Agent that supports MCP
- **Platform automation executors** -- macOS AppleScript/JXA, Windows COM, Linux DBus
- **Auto-discovery** of system applications with automation support
- **AI-powered aai.json generation** from app automation interfaces
- **Web UI** for configuration and call history management
- **Progressive tool loading** -- avoids context explosion by loading app tools on demand

## Installation

```bash
npm install -g aai-gateway
```

Requires Node.js >= 18.

## Quick Start

1. **Start the gateway** in MCP mode:
   ```bash
   aai-gateway --mcp
   ```
2. **Add to your Agent's MCP config** (see Agent Configuration below).
3. **Use it** -- ask your Agent to perform actions like "Send an email to alice@example.com using Mail".

## CLI Commands

| Command                    | Description                                          |
| -------------------------- | ---------------------------------------------------- |
| `aai-gateway --mcp`       | Start as MCP server (stdio) for Agent integration    |
| `aai-gateway --web`       | Start with Web UI for management                     |
| `aai-gateway --scan`      | Scan `~/.aai/` for configured applications           |
| `aai-gateway --discover`  | Auto-discover system apps with automation support    |
| `aai-gateway --generate <app>` | Use AI to generate `aai.json` for an application |

## Agent Configuration

**Cursor / Cline** (MCP settings JSON):
```json
{
  "mcpServers": {
    "aai": {
      "command": "aai-gateway",
      "args": ["--mcp"]
    }
  }
}
```

**Continue.dev** (`~/.continue/config.ts`):
```typescript
mcpServers: {
  aai: {
    command: "aai-gateway",
    args: ["--mcp"]
  }
}
```

## Configuration

Gateway configuration lives at `~/.aai/config.json`:

```json
{
  "scanPaths": ["~/.aai"],
  "defaultTimeout": 30,
  "logLevel": "info",
  "enableWebUI": true,
  "httpPort": 3000
}
```

Application descriptors are stored at `~/.aai/<appId>/aai.json`. See the [AAI Protocol spec](https://github.com/gybob/aai-protocol) for the aai.json schema.

## Development

```bash
npm install          # Install dependencies
npm run dev          # Run in development mode (vite-node)
npm run build        # Compile TypeScript and bundle with Vite
npm run test         # Run tests (vitest)
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage
npm run lint         # Lint with ESLint
npm run format       # Format with Prettier
npm run typecheck    # Type-check without emitting
```

## Links

- [AAI Protocol Spec](https://github.com/gybob/aai-protocol)
- Website (TBD)

## License

MIT
