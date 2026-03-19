## 1. Descriptor & Schema

- [x] 1.1 Replace `execution.type` with `execution.via` + `transport` + optional `launch`
- [x] 1.2 Update `parseAaiJson` schema validation to accept `execution.via: "mcp"` and transport-specific variants
- [x] 1.3 Define a stable on-disk format for generated MCP-backed `aai.json` (no plaintext secrets)

## 2. Local MCP Registry (Load/Store)

- [x] 2.1 Add a registry module to load imported MCP entries at startup (user-scoped config path)
- [x] 2.2 Add write/update helpers for registry entries (used by CLI import/refresh)
- [x] 2.3 Integrate registry loading into gateway initialization and expose each entry as `app:<id>` in `tools/list`

## 3. MCP Executor (Forwarding)

- [x] 3.1 Implement an `McpExecutor` interface with `connect`, `listTools`, and `callTool`
- [x] 3.2 Implement stdio transport (spawn process, MCP initialize handshake, `tools/call`)
- [x] 3.3 Implement remote transport (`streamable-http`, legacy `sse`) or return a clear NOT_IMPLEMENTED error if transport is configured but unsupported
- [x] 3.4 Add lazy connect + connection reuse + restart-on-failure semantics per imported app
- [x] 3.5 Wire `aai:exec` to forward MCP-backed descriptors via `McpExecutor` with consent enforcement

## 4. CLI: Import & Refresh

- [x] 4.1 Add `aai-gateway mcp import` command (stdio + remote options, `--id` override, metadata flags)
- [x] 4.2 Implement import flow: connect → `tools/list` → generate `aai.json` → write descriptor + registry entry
- [x] 4.3 Store any provided remote credentials/headers in secure storage keyed by `app.id`
- [x] 4.4 Add `aai-gateway mcp refresh <id>` (or `mcp import --refresh`) to re-fetch `tools/list` and update stored descriptor

## 5. Guides, UX, and Consent

- [x] 5.1 Generate operation guides for MCP-backed apps from stored descriptors (tool list + `aai:exec` examples)
- [x] 5.2 Add “remote MCP” safety messaging in guides where applicable (without leaking secrets)
- [x] 5.3 Ensure consent prompts include app name + tool description derived from imported descriptor

## 6. Tests & Docs

- [x] 6.1 Add unit tests for MCP → `aai.json` generation (tool mapping, stable `app.id`)
- [x] 6.2 Add unit tests for registry read/write and startup loading behavior
- [x] 6.3 Update `README.md` with new CLI commands and the “import MCP” integration path
