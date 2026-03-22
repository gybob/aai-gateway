## Why

AAI Gateway currently exposes MCP to upstream AI tools over stdio, but the target client ecosystem has standardized around `streamable-http`. Long-running ACP prompts already emit incremental `session/update` events, yet the current northbound model depends on stdio plus MCP task/progress behavior that many clients handle poorly.

## What Changes

- **BREAKING** Replace the northbound MCP server transport from stdio to `streamable-http` and remove the old stdio-facing server bootstrap/code paths.
- Keep downstream MCP support unchanged so the gateway can still connect to MCP apps over `stdio`, `streamable-http`, and `sse`.
- Bridge ACP `session/update` events into the northbound HTTP response stream so long-running prompts stay active without requiring clients to rely on MCP task support.
- Isolate runtime state per connected AI client session so multiple tools can share one gateway instance without leaking caller identity, task state, or ACP sessions across clients.
- Expose skill execution guidance with the gateway-managed skill base path so upstream AI tools know where imported skills actually live inside `aai-gateway`.

## Capabilities

### New Capabilities
- `gateway-server-transport`: Defines the northbound MCP server transport exposed by AAI Gateway, including `streamable-http` serving, removal of northbound stdio, and per-client runtime isolation.

### Modified Capabilities
- `acp-agent-execution`: Change ACP execution requirements so long-running prompt updates can be surfaced incrementally through the gateway and ACP runtime sessions are isolated per connected client.
- `skill-execution`: Change skill execution requirements so gateway-generated skill guidance includes the managed skill base path visible to upstream AI tools.

## Impact

- MCP server bootstrap and configuration
- Removal of the old northbound stdio server path
- Connection/session lifecycle management
- ACP executor session management and observer/event bridging
- Skill guide generation and skill metadata surfaced to upstream clients
- Gateway runtime state for caller identity and downstream session delivery
- Tests and docs for streamable HTTP serving, ACP streaming, and multi-client behavior
