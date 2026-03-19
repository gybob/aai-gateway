# AAI Gateway

## 📢 项目状态

**该项目正在积极开发中，很快就会发布。**

欢迎大家参与开发贡献！如果您对项目感兴趣或有任何想法，欢迎：

- 🐛 提交 Issue 和 Feature Request
- 💬 参与讨论
- 🤝 贡献代码
- 📢 分享给社区

## 🏗️ Architecture Overview (v0.4.0)

AAI Gateway v0.4.0 introduces a refactored architecture with modular discovery and unified storage:

### Discovery Layer

```
DiscoveryManager
├── DesktopDiscoverySource (priority 100)
├── AgentDiscoverySource (priority 90)
└── ManagedDiscoverySource (priority 80)
```

- **DiscoveryManager**: Centralized discovery with caching
- **Discovery Sources**: Modular, pluggable discovery implementations
- **Priority-based execution**: Sources execute in priority order
- **Automatic caching**: Results cached with 5-minute TTL

### Storage Layer

```
FileRegistry<T>
├── McpRegistry (manages MCP servers)
├── SkillRegistry (manages skills)
└── ManagedRegistry (manages gateway apps)
```

- **FileRegistry**: Generic file-based registry with JSON storage
- **SimpleCache**: In-memory cache with TTL support
- **Unified API**: Consistent interface across all storage operations

### Integration

The MCP server now uses `DiscoveryManager` for all discovery operations:

```typescript
import { createDiscoveryManager } from './discovery/index.js';

const { manager } = createDiscoveryManager();
const apps = await manager.scanAll({ devMode: true });
```

---

## One MCP. Many Apps. Less Context.

AAI Gateway is one MCP server that lets local agents reach heterogeneous apps through one entrypoint.

It is built around a small AAI descriptor whose job is not to redefine downstream protocols, but to solve two concrete problems:

- context explosion
- unified onboarding across different protocol families

## Core Idea

AAI is a minimal descriptor, not an execution protocol.

It contains only:

- `app`: display metadata for listing and authorization
- `access`: how the gateway connects to the target
- `exposure`: the first two exposure layers

Detailed capability information is loaded on demand from the underlying system:

- `mcp` -> MCP-native discovery
- `skill` -> `SKILL.md` and related assets from a local skill directory or remote skill root
- `acp-agent` -> ACP-native initialization and session metadata
- `cli` -> gateway-managed CLI integration

## Why This Exists

Traditional tool registries push too much detail too early:

```text
50 apps x 20 tools each = 1000+ items in context
```

AAI Gateway reduces that pressure by using layered exposure:

- Layer 1: `keywords`
- Layer 2: `summary`
- Layer 3: detailed capability metadata loaded only when needed

The gateway therefore becomes:

- one local registry of apps
- one MCP entrypoint for local agents
- one place to manage exposure level and app enable/disable policy

## Descriptor Shape

```json
{
  "schemaVersion": "2.0",
  "version": "1.0.0",
  "app": {
    "name": {
      "default": "Example App",
      "en": "Example App",
      "zh-CN": "示例应用"
    },
    "iconUrl": "https://example.com/icon.png"
  },
  "access": {
    "protocol": "mcp",
    "config": {}
  },
  "exposure": {
    "keywords": ["example", "tool"],
    "summary": "A short summary for layer-2 exposure."
  }
}
```

Rules:

- `app.name.default` is required
- `app.iconUrl` is optional
- `exposure` contains only `keywords` and `summary`
- no centralized `tools`
- no embedded user policy
- no old `execution.via/transport/launch` model

## Access Protocols

### `mcp`

Use this when the target is an MCP server.

Supported config shapes:

```json
{
  "protocol": "mcp",
  "config": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem"]
  }
}
```

```json
{
  "protocol": "mcp",
  "config": {
    "transport": "streamable-http",
    "url": "https://example.com/mcp"
  }
}
```

```json
{
  "protocol": "mcp",
  "config": {
    "transport": "sse",
    "url": "https://example.com/sse"
  }
}
```

Layer-3 detail comes from MCP-native discovery.

### `skill`

Use this when the target is a skill directory.

Local skill:

```json
{
  "protocol": "skill",
  "config": {
    "path": "/Users/bob/.local/share/aai-gateway/apps/openai-docs/"
  }
}
```

Remote skill:

```json
{
  "protocol": "skill",
  "config": {
    "url": "https://example.com/.well-known/skill/"
  }
}
```

Layer-3 detail comes from the skill root, including `SKILL.md` and any related assets.

### `acp-agent`

Use this when the target speaks ACP over stdio.

This includes:

- native ACP agents
- ACP adapters wrapping another agent

Config shape:

```json
{
  "protocol": "acp-agent",
  "config": {
    "command": "opencode",
    "args": ["acp"]
  }
}
```

Adapter example:

```json
{
  "protocol": "acp-agent",
  "config": {
    "command": "npx",
    "args": ["-y", "@zed-industries/codex-acp"]
  }
}
```

Layer-3 detail comes from ACP-native initialization and session metadata.

### `cli`

Use this when the target is operated as a command-line app but does not expose MCP or ACP directly.

Config shape:

```json
{
  "protocol": "cli",
  "config": {
    "command": "claude",
    "args": ["-p"]
  }
}
```

The descriptor does not define CLI capability schemas. Layer-3 detail is managed by the gateway's CLI integration logic.

## Full Examples

### MCP app

```json
{
  "schemaVersion": "2.0",
  "version": "1.0.0",
  "app": {
    "name": {
      "default": "Filesystem",
      "en": "Filesystem",
      "zh-CN": "文件系统"
    },
    "iconUrl": "https://example.com/icons/filesystem.png"
  },
  "access": {
    "protocol": "mcp",
    "config": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem"]
    }
  },
  "exposure": {
    "keywords": ["files", "local", "filesystem"],
    "summary": "用于读取、写入、列出和搜索本地文件。"
  }
}
```

### Skill app

```json
{
  "schemaVersion": "2.0",
  "version": "1.0.0",
  "app": {
    "name": {
      "default": "OpenAI Docs",
      "en": "OpenAI Docs",
      "zh-CN": "OpenAI 文档"
    }
  },
  "access": {
    "protocol": "skill",
    "config": {
      "url": "https://example.com/.well-known/skill/"
    }
  },
  "exposure": {
    "keywords": ["openai", "docs", "api"],
    "summary": "用于查询 OpenAI API 和官方文档。"
  }
}
```

### ACP agent

```json
{
  "schemaVersion": "2.0",
  "version": "1.0.0",
  "app": {
    "name": {
      "default": "OpenCode",
      "en": "OpenCode",
      "zh-CN": "OpenCode"
    }
  },
  "access": {
    "protocol": "acp-agent",
    "config": {
      "command": "opencode",
      "args": ["acp"]
    }
  },
  "exposure": {
    "keywords": ["code", "agent", "development"],
    "summary": "用于代码编辑、分析和开发任务的 ACP agent。"
  }
}
```

### CLI app

```json
{
  "schemaVersion": "2.0",
  "version": "1.0.0",
  "app": {
    "name": {
      "default": "Claude CLI",
      "en": "Claude CLI",
      "zh-CN": "Claude CLI"
    }
  },
  "access": {
    "protocol": "cli",
    "config": {
      "command": "claude",
      "args": ["-p"]
    }
  },
  "exposure": {
    "keywords": ["code", "cli", "assistant"],
    "summary": "通过命令行方式调用的本地 agent。"
  }
}
```

## Discovery

AAI Gateway should support three descriptor locations:

- desktop apps: ship a descriptor with the app or another app-owned location that the gateway scans
- CLI apps: install descriptors into a gateway-managed local directory
- web apps: publish a descriptor at a fixed well-known URL

Suggested locations:

| Type | Location |
| --- | --- |
| Web app | `https://<host>/.well-known/aai.json` |
| macOS app | `<App>.app/Contents/Resources/aai.json` |
| Windows app | `<App directory>/aai.json` |
| Linux app | `/usr/share/<app>/aai.json` |
| Gateway-managed CLI install | `~/.local/share/aai-gateway/apps/<app>/aai.json` |

Notes:

- macOS sandboxed apps should not be required to write into the gateway-managed directory
- imported `mcp`, imported `skill`, and gateway-managed CLI assets belong under the gateway-managed directory
- imported skills are stored as full directories, not just a single `SKILL.md`

## Authorization

AAI Gateway keeps the first authorization stage focused on display metadata.

The consent UI should identify the app using:

- `app.name`
- `app.iconUrl`

User policy such as:

- enabled / disabled
- per-agent visibility
- exposure level

belongs to gateway-local configuration, not to the descriptor.

## Installation

Add AAI Gateway to your MCP client configuration:

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

## MCP Import

AAI Gateway can import an existing MCP server and generate a minimal AAI descriptor from MCP-native discovery.

All human-facing management commands use the `aai-gateway ...` CLI.

It should also support importing skills. Imported integrations are gateway-owned assets:

- imported MCP servers get generated local descriptors
- imported skills are copied or downloaded into a gateway-managed local directory
- `keywords` and `summary` can be collected in the CLI or generated with agent assistance and then confirmed by the user

Examples:

```bash
aai-gateway mcp import --name "Filesystem MCP" --command npx --arg -y --arg @modelcontextprotocol/server-filesystem
```

```bash
aai-gateway mcp import --id remote-docs --name "Remote Docs" --url https://example.com/mcp --transport streamable-http
```

```bash
aai-gateway mcp refresh remote-docs
```

```bash
aai-gateway skill import --path /path/to/skill-dir
```

```bash
aai-gateway skill import --url https://example.com/.well-known/skill/
```

## Current Direction

AAI Gateway is still early-stage. The project favors a clean model over compatibility layers. If old code does not fit the new descriptor architecture, it should be rewritten or removed.

## Links

- **[AAI Protocol Spec](https://github.com/gybob/aai-protocol)** - protocol work
- [Report Issues](https://github.com/gybob/aai-gateway/issues) - bug reports and feature requests

## License

Apache-2.0
