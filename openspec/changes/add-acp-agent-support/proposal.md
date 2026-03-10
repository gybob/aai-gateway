## Why

AAI Gateway currently supports Desktop apps (via IPC/AppleScript/COM/DBus) and Web apps (via HTTP). However, a new category of applications is emerging: **ACP Agents** - AI coding agents that implement the Agent Client Protocol (OpenCode, Claude Code, Gemini CLI, Cline, etcThese agents cannot be controlled using existing mechanisms because:

1. They communicate via ACP (JSON-RPC over stdio), not HTTP or platform IPC
2. They provide session-based conversation interfaces, not REST APIs
3. They are not desktop apps with `aai.json` bundles, nor web services with `.well-known/aai.json`

## What Changes

- Add ACP Agents as a new application category alongside Desktop and Web apps
- Implement Agent discovery by checking if known ACP agent commands exist on the system
- Implement Agent execution via stdio-based JSON-RPC (ACP protocol)
- Add built-in agent descriptors for popular agents (OpenCode, Claude Code, Gemini CLI, Cline)
- Extend `execution.type` in aai.json to support `acp` type with `start` configuration object
- Agents appear as `app:<agent-id>` in tools/list, same as desktop apps

## Capabilities

### New Capabilities

- `acp-discovery`: Scan system for installed ACP agents by checking command existence
- `acp-execution`: execute ACP protocol methods (initialize, session/new, session/prompt, etc.) via stdio

### Modified Capabilities

- `aai-json-schema`: extended `execution.type` enum to include `acp`
- `tools-list`: now includes ACP agents alongside desktop apps

## Impact

- **src/types/aai-json.ts**: Add `AcpExecution` interface with `type: 'acp'` and `start` configuration
- **src/parsers/schema.ts**: add `acp` to execution type validation
- **src/discovery/agent-registry.ts**: new file - Agent discovery and registry
- **src/discovery/descriptors/agents/**: new directory - Built-in agent descriptors
- **src/executors/acp.ts**: new file - ACP stdio executor
- **src/mcp/server.ts**: add agentRegistry, agent discovery, and execution routing
- **src/mcp/guide-generator.ts**: add 'acp' platform support for guide generation
