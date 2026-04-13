# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

「 以第一性原理！从原始需求和问题本质出发，不从惯例和模板出发。
1. 不要假设自己清楚自己想要什么。动机或目标不清晰时，停下来讨论。
2. 目标清晰但路径不是最短的，直接告诉我并建议更好的方案。
3. 遇到问题追根因，不打补丁。每个决策都要能回答“为什么”。
4. 输出说重点，砍掉一切不改变决策的信息。
」

## Build & Development Commands

```bash
npm run build          # tsc + vite build + chmod CLI
npm run dev            # vite-node src/index.ts (dev mode)
npx tsc --noEmit       # type check only
npm run lint           # eslint src --ext .ts
npm run lint:fix       # eslint with auto-fix
npm run format         # prettier
npm test               # vitest run
npm run test:watch     # vitest watch mode
npm run test:coverage  # vitest with coverage
```

## Architecture

AAI Gateway is a unified MCP gateway that manages **Agent Apps** (MCP servers, Skills, ACP agents). It runs as a single MCP server (stdio) and routes tool calls to downstream apps, enabling multiple AI agents to share tools with 99% context token savings via two-phase disclosure (one-line summaries → full schemas on demand).

### Core Flow

```
AI Agent (Claude Code / Codex / OpenCode)
    ↓ MCP protocol (stdio)
  Server (src/mcp/server.ts)
    ↓
  Gateway (src/core/gateway.ts)  ← orchestrator
    ↓
  ExecutionCoordinator (src/core/execution-coordinator.ts)
    ├─ MCP Executor  → downstream MCP servers (stdio/SSE/HTTP)
    ├─ Skill Executor → reads SKILL.md files
    └─ ACP Executor  → spawns agent subprocesses (JSON-RPC)
```

### Key Modules

- **Gateway** (`src/core/gateway.ts`): Main orchestrator. Handles `aai:exec`, import flows, enable/disable, search. Protocol-agnostic — delegates execution to `ExecutionCoordinator`.
- **ExecutionCoordinator** (`src/core/execution-coordinator.ts`): Routes to the correct executor by protocol. Manages inactivity timeouts.
- **AppRegistry** (`src/core/app-registry.ts`): In-memory `Map<appId, RuntimeAppRecord>` of all known apps.
- **Executors** (`src/executors/`): Each implements the `Executor` interface (`interface.ts`). `acp.ts` is the most complex — manages subprocess lifecycle, session/turn state machine, permission requests, and streaming.
- **Storage** (`src/storage/`): File-based registries (`FileRegistry<T>`) persisting MCP configs, skills, and managed apps to `~/.local/share/aai-gateway/`.
- **Discovery** (`src/discovery/`): Auto-discovers preset agents (Claude Code, Codex, OpenCode) via command/file checks.
- **Tool Definitions** (`src/core/tool-definitions.ts`): Defines gateway-level MCP tools (`aai:exec`, `mcp:import`, `skill:import`, `search:discover`, etc.).

### Two-Phase Disclosure

The gateway exposes each downstream app as a one-line summary tool (`app:<appId>`) costing ~7 tokens. When the agent calls it, the full tool schemas are loaded on demand and injected via `tools/listChanged`. This is the core token savings mechanism.

### ACP Executor State Machine

`src/executors/acp.ts` manages prompt turns through states: `running` → `waiting_permission` → `completed`/`failed`. Key concepts:
- **PromptTurnState**: Tracks each turn's output, timers, permission requests
- **Session binding**: One active turn per session, others queued
- **Inactivity timeout**: Fails turns with no activity within the timeout window

### Storage Paths

- App descriptors & data: `~/.local/share/aai-gateway/apps/`
- Agent state (per-agent visibility): `~/.local/share/aai-gateway/agents/`
- Config & logs: `~/.aai-gateway/` (config.json, logs/)

## Conventions

- **Commit messages**: Always in English.
- **ESM only**: `"type": "module"` in package.json. Use `.js` extensions in imports.
- **Strict TypeScript**: No implicit any, no unused locals/params.
- **Logging**: Pino JSON logger writes to file (not stdout — stdout is reserved for MCP JSON-RPC). Use `logger.info` for key lifecycle events, `logger.debug` for internal protocol details.
- **Error handling**: Throw `AaiError` with structured error codes (`INVALID_REQUEST`, `UNKNOWN_APP`, `TIMEOUT`, etc.).
- **Path alias**: `@/*` maps to `src/*` in tsconfig but vite resolves it — use relative imports in source.
