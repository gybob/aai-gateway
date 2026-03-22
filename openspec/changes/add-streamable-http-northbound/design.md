## Context

AAI Gateway currently boots only a `StdioServerTransport` for northbound MCP traffic even though downstream execution already spans multiple transport styles:

- MCP apps may use `stdio`, `streamable-http`, or `sse`
- ACP agents may run for a long time and emit incremental `session/update` notifications
- skills are stored under gateway-managed directories rather than the AI tool's own default skill roots

The present runtime model assumes a mostly single-client server process:

- caller identity is stored at server scope
- ACP session reuse is keyed only by app `localId`

That works for a local stdio attachment, but it breaks down once the gateway is treated as a shared MCP endpoint for multiple AI tools. The immediate product need is to replace northbound stdio with `streamable-http`, let one gateway instance serve many AI clients over HTTP, keep long-running ACP prompts alive by streaming incremental updates, and make skill guidance explicitly point back to the gateway-managed skill base path.

## Goals / Non-Goals

**Goals:**
- Expose AAI Gateway only as a northbound `streamable-http` MCP server
- Remove the old northbound stdio bootstrap and related code paths
- Allow multiple AI tools to connect to one gateway endpoint concurrently
- Isolate runtime state per connected client session
- Stream ACP prompt updates back to the active client connection as they happen
- Surface gateway-managed skill base paths in skill guidance returned to upstream AI tools

**Non-Goals:**
- Redesign downstream descriptor formats or protocol families
- Replace downstream MCP transport support, which already exists
- Solve distributed deployment, authentication, or reverse proxy concerns in this change
- Guarantee resumable/replayable long-running sessions across gateway restarts

## Decisions

1. **Add a dedicated northbound server transport layer**
- Decision: replace the hard-coded northbound stdio bootstrap with a `streamable-http` server bootstrap and remove the obsolete stdio-facing server code.
- Rationale: the target client ecosystem already expects `streamable-http`; keeping stdio as a parallel northbound mode adds maintenance cost without serving the intended product direction.
- Alternative considered: keep stdio alongside HTTP. Rejected because the requested product behavior is to move the upstream contract to HTTP, not maintain two northbound protocols.

2. **Use one gateway listener for many clients**
- Decision: one gateway process SHALL bind one configured HTTP listener and serve multiple MCP clients concurrently through that shared endpoint.
- Rationale: multiple AI tools connecting to one server does not require multiple ports; the problem is state isolation, not listener allocation.
- Alternative considered: launch one gateway instance per AI tool or per port. Rejected because it complicates lifecycle management and makes shared discovery/registry state harder to reason about.

3. **Introduce per-client runtime context**
- Decision: create a runtime context keyed by the northbound client session/connection. The context owns caller identity, request-scoped observers, and downstream session handles.
- Rationale: current server-global state will leak across clients once the gateway becomes a shared HTTP service.
- Alternative considered: keep state global and attempt to reset it per request. Rejected because long-lived prompts and overlapping requests still race.

4. **Scope ACP sessions by client context and app**
- Decision: ACP session reuse SHALL be keyed by `(clientContextId, appLocalId)` rather than `appLocalId` alone.
- Rationale: different AI tools must not share one ACP conversation thread just because they target the same app.
- Alternative considered: create a brand-new ACP session for every prompt. Rejected because it discards useful within-client continuity and adds avoidable startup latency.

5. **Adopt a stream-first bridge for ACP prompt execution**
- Decision: ACP `session/update` notifications SHALL flow through a common observer pipeline that can write incremental data to the active northbound response stream. The final ACP response still closes the call with a terminal MCP tool result.
- Rationale: this uses the protocol behavior ACP already provides and removes hard dependence on MCP tasks/progress for long-running prompts.
- Alternative considered: synthesize keepalive-only traffic without forwarding meaningful updates. Rejected because it prevents clients from consuming useful incremental output and still leaves the UX opaque.

6. **Expose gateway-managed skill base paths explicitly**
- Decision: skill guides returned through the gateway SHALL include the gateway-managed base path that contains imported/stored skills.
- Rationale: AI tools cannot assume their own default skill directories match the gateway's managed storage layout, so the gateway has to tell them the real base path.
- Alternative considered: keep skill guides generic and let clients infer locations. Rejected because the relevant path is owned by the gateway, not by the client.

## Risks / Trade-offs

- **Connection-scoped state increases runtime complexity** -> Mitigation: keep one explicit context object per client and make downstream executors depend on that object instead of hidden globals.
- **HTTP serving introduces listener configuration and lifecycle concerns** -> Mitigation: start with localhost-only binding and explicit host/port/path configuration.
- **ACP output can be noisy or high-volume** -> Mitigation: centralize update normalization and preserve the existing truncation/merge rules before forwarding.
- **Removing northbound stdio may break ad hoc local workflows** -> Mitigation: update docs and CLI defaults so the supported startup path is unambiguous.
- **Skill path disclosure can drift from storage layout** -> Mitigation: source the base path from the same storage/config module that owns managed skill directories.

## Migration Plan

1. Add a transport bootstrap for `streamable-http` without changing downstream executor contracts immediately.
2. Introduce client-scoped runtime context and update the server and ACP executor to use it.
3. Bridge ACP `session/update` events into the northbound observer/stream path.
4. Update skill guide generation so returned guidance includes the managed skill base path.
5. Remove the old northbound stdio bootstrap once the HTTP path is verified by tests.

## Open Questions

- Whether the initial HTTP path should default to `127.0.0.1` only or also expose a configurable hostname in the primary CLI surface.
