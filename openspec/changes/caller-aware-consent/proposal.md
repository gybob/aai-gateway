## Why

The current Gateway Consent (Phase 1 authorization) lacks caller identification. When an MCP client (e.g., Claude, Cursor, Windsurf) requests tool access, the consent dialog does not display which client is making the request. Additionally, consent is granted globally rather than per-caller, meaning Claude's authorization is reused for Cursor - a security concern where users may want to restrict specific clients from certain tools.

## What Changes

- Display MCP caller process name in consent dialog (e.g., "Claude Desktop", "Cursor", "Windsurf")
- Store consent decisions per-caller instead of globally
- Require re-authorization when a different MCP client accesses the same tool
- Update consent storage schema to include caller identification
- Modify consent manager to track and validate caller identity

## Capabilities

### New Capabilities

- `caller-identity`: Capability to identify and track which MCP client is making tool requests
- `caller-scoped-consent`: Per-caller consent storage and validation

### Modified Capabilities

- `gateway-consent`: Existing consent mechanism now requires caller context for authorization decisions

## Impact

- **src/consent/manager.ts**: Add caller parameter to consent methods
- **src/consent/dialog/**: Update dialog UI to show caller name
- **src/mcp/server.ts**: Extract caller identity from MCP connection context
- **src/storage/**: Update consent storage format to include caller ID
- **aai-protocol/spec/security.md**: Document caller-aware consent flow
