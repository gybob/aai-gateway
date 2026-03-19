## Why

AAI Gateway already normalizes integrations via `aai.json`, but it cannot execute tools that live behind existing MCP servers (remote or local) without writing bespoke glue. Adding an MCP connector + import flow lets teams reuse the MCP ecosystem while keeping AAI Gateway’s progressive-disclosure model (`tools/list` stays small).

## What Changes

- Add a new descriptor execution mode for MCP-backed apps using `execution.via: "mcp"`, enabling `aai:exec` to forward calls to another MCP server.
- Add a local MCP server registry that AAI Gateway loads on startup, exposing each imported MCP server as a single `app:<id>` entry in `tools/list`.
- Add a CLI import command to connect to a local/remote MCP server, read `tools/list`, generate a local `aai.json`, and register it for AAI Gateway.
- Define refresh behavior (manual and/or TTL) for imported MCP descriptors so tool sets can evolve without code changes.
- **BREAKING** Replace ambiguous `execution.type` with an explicit execution model:
  - `execution.via` selects the gateway executor family (`aai`, `mcp`, `acp`)
  - `execution.transport.type` selects the concrete connection transport (`stdio`, `http`, `streamable-http`, `sse`, `apple-events`, `dbus`, `com`)
  - `execution.launch` declares how to start a local process when required
- **BREAKING** Rename `web:discover` to `remote:discover` (the discovery tool is not web-only once MCP-backed and other remote descriptors exist).

## Capabilities

### New Capabilities

- `mcp-execution`: Describe how `aai.json` represents an MCP-backed app and how `aai:exec` forwards execution to that MCP server (transport, lifecycle, timeouts, error mapping).
- `mcp-import`: Describe the CLI import flow and on-disk registry format used to persist imported MCP servers and generated `aai.json` descriptors (including exposure/discovery metadata).

### Modified Capabilities

- (none)

## Impact

- `src/mcp/server.ts`: `aai:exec` gains an execution branch for MCP-backed descriptors.
- `src/types/aai-json.ts`: descriptor execution types move from `execution.type` to `execution.via` + `transport` + optional `launch`.
- `src/cli.ts`: new subcommand for importing MCP servers into the local registry.
- New storage location for imported MCP servers/descriptors (user-scoped config/cache) and secure handling of any credentials/headers.
