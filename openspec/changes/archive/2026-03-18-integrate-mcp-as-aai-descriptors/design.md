## Context

AAI Gateway normalizes application integrations through `aai.json` and keeps MCP client context small via progressive disclosure: `tools/list` only returns lightweight `app:<id>` entries plus `web:discover` and `aai:exec`. Execution today is limited to HTTP (web descriptors), native desktop bindings (apple-events/dbus/com), and ACP agents; `stdio` execution is explicitly not implemented.

Many users already have useful capabilities exposed as MCP servers (local stdio servers or remote servers). Today, the gateway can describe those tools only if they are manually rewritten as `aai.json`, and it still cannot execute them without bespoke glue.

This change introduces a first-class “MCP-backed app” integration path:
1) import an MCP server into a local registry, generating a corresponding `aai.json`, and
2) execute imported tools by forwarding `aai:exec` calls to the MCP server.

Constraints:
- Preserve progressive disclosure (one tool entry per imported MCP server).
- Preserve per-caller consent enforcement already implemented by the gateway.
- Keep secrets out of plaintext configs; reuse existing secure storage patterns where possible.

## Goals / Non-Goals

**Goals:**
- Represent MCP-backed apps in `aai.json` (execution binding + tool list) without requiring per-app code changes.
- Provide a CLI import flow that connects to an MCP server, reads `tools/list`, generates `aai.json`, and registers the integration for startup loading.
- Allow `aai:exec` to execute tools for MCP-backed apps by forwarding to the corresponding MCP server.
- Keep `tools/list` output small by exposing each imported MCP server as a single `app:<id>` entry that returns an operation guide.
- Unify execution typing so gateway executor selection and transport selection are not conflated.

**Non-Goals:**
- Full support for MCP `resources/*` and `prompts/*` in this iteration (tools-only).
- Automatic inference of authentication beyond storing user-supplied headers/tokens securely for remote transports.
- Turning AAI Gateway into a general MCP server manager (updates, installs, lifecycle orchestration beyond minimal execution needs).
- Implementing every possible AAI transport in this iteration (this change targets MCP forwarding specifically).

## Decisions

1) **Normalize execution typing as `via` + `transport` + optional `launch`**
- Decision: replace `execution.type` with:
  - `execution.via`: gateway executor family (`aai`, `mcp`, `acp`)
  - `execution.transport.type`: concrete connection transport (`stdio`, `http`, `streamable-http`, `sse`, `apple-events`, `dbus`, `com`)
  - `execution.launch`: optional local process start information (`command`, `args`, `env`, `cwd`)
- Rationale: the descriptor should answer two separate questions:
  - Which execution protocol should AAI Gateway speak to the target (`aai`, `mcp`, `acp`)?
  - Which concrete transport should that executor use to connect (`stdio`, `http`, `apple-events`, etc.)?
  A single `execution.type` cannot carry both meanings without ambiguity.
- Consequence: descriptors become easier to evolve without creating values such as `mcp-sse` or `aai-stdio`.
- Alternatives considered:
  - Keep `execution.type` and add flags: rejected (ambiguity remains and grows).
  - Encode transport into `via` (e.g., `mcp-sse`): rejected (type explosion, harder evolution).

2) **Use concrete transport names instead of abstract stream categories**
- Decision: supported transport values are `stdio`, `http`, `streamable-http`, `sse`, `apple-events`, `dbus`, and `com`.
- Rationale: abstract names like `stream` are too vague for dispatch. AAI Gateway should be able to read `transport.type` and immediately choose the correct connector.
- Alternatives considered:
  - `stream` as a transport type: rejected because it does not identify a concrete connector.
  - Platform-level abstractions like `ipc` / `bridge`: rejected because they add taxonomy without improving execution behavior.

3) **Keep authentication separate from execution**
- Decision: authentication remains defined by top-level `auth`. Execution transport MAY declare `defaultHeaders` for non-sensitive connection metadata, but descriptors SHALL NOT embed bearer tokens, API secrets, or session cookies under `execution`.
- Rationale: `auth` answers “how credentials are obtained”, while `execution` answers “where and how requests are sent”. Mixing the two creates multiple sources of truth and leaks secrets into portable descriptors.
- Consequence: remote MCP imports can store credentials in secure storage and inject them at runtime without writing them into generated descriptors.

4) **Introduce a user-scoped MCP registry + generated descriptor store**
- Decision: Store “connection config” (how to reach the MCP server) separately from “generated descriptor” (the `aai.json` created from `tools/list`), so refresh can update tools without losing user connection metadata.
- Secrets handling: any sensitive fields (e.g., Authorization headers) should be stored in the gateway’s secure storage, keyed by imported `app.id`, not in plaintext registry files.
- Alternatives considered:
  - Single JSON file containing everything including secrets: rejected due to security.
  - Only regenerate at startup and never store: rejected due to startup latency and offline usage.

5) **Import flow generates stable `app.id` + tool list mapped 1:1**
- Decision: The CLI import command assigns a stable `app.id` for the imported MCP server (default derived from the provided name; overridable), and maps each MCP tool entry directly into `aai.json.tools[]`:
  - `name` → `tools[].name`
  - `description` → `tools[].description`
  - `inputSchema` → `tools[].parameters`
- Alternatives considered:
  - Prefix/rename tools to avoid collisions: not needed because AAI Gateway keeps one app at a time under `aai:exec(app, tool, ...)`; collisions only matter within a single MCP server, which is already constrained by MCP tool naming.

6) **Execution via an internal MCP client (“McpExecutor”)**
- Decision: Implement a small client that can:
  - connect (`stdio` first, remote HTTP transports later),
  - perform MCP initialize handshake,
  - call `tools/call` and return results (including error mapping),
  - optionally refresh `tools/list` on demand for import/refresh flows.
- Lifecycle: keep a per-imported-app connection/process cache with timeouts and crash recovery (restart stdio process if it exits).
- Alternatives considered:
  - “Shell out” to an external MCP client binary: rejected (extra dependency, weaker integration with consent + logging).

7) **Discovery naming + exposure strategy is explicit**
- Decision: rename `web:discover` to `remote:discover` and make “how this integration appears to the agent” explicit via descriptor/registry metadata:
  - `exposure: "list"` → show a single `app:<id>` entry in `tools/list`
  - `exposure: "discover"` → not shown in `tools/list`; available via `remote:discover`
- Rationale: “discover” is not inherently web-only once we support remote MCP-backed descriptors and other remote descriptor sources.
- Alternatives considered:
  - Keep `web:discover`: rejected (misleading name).
  - Implicit exposure rules only in code: rejected (hard for spec/tooling/agents to reason about).

8) **Preserve progressive disclosure by exposing imported MCP servers as `app:<id>` entries**
- Decision: On startup, load imported MCP entries and expose one `app:<id>` tool per entry in `tools/list`. Calling `app:<id>` returns an operation guide derived from the generated descriptor (same UX as desktop/web/agent).
- Alternatives considered:
  - Add every imported MCP tool directly to `tools/list`: rejected (context explosion, contradicts gateway’s core design).

## Risks / Trade-offs

- **[Schema compatibility]** MCP `inputSchema` may be loosely-defined or contain unsupported JSON Schema features → Mitigation: store and echo schemas without over-validation; validate only what the gateway requires (object-ness) and surface warnings during import.
- **[Transport support]** Remote MCP transports (`streamable-http` and legacy `sse`) may not be supported equally by the current SDK version → Mitigation: implement `stdio` first; preserve both transport names in the schema so descriptors remain forward-compatible.
- **[Process/resource usage]** Many imported stdio MCP servers could increase background processes → Mitigation: lazy-connect on first `aai:exec` per app; idle timeouts; explicit stop on shutdown.
- **[Security]** Importing remote MCP servers increases data exfiltration risk → Mitigation: per-tool consent remains mandatory; surface “remote server” warnings in operation guides; keep secrets in secure storage.
- **[Tool drift]** MCP tool sets can change over time → Mitigation: add a refresh command and/or TTL-based refresh that regenerates `aai.json` while keeping stable `app.id`.
