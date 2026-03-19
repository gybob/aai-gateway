## ADDED Requirements

### Requirement: MCP import command
AAI Gateway SHALL provide a CLI command that imports an MCP server configuration into a local registry and generates an `aai.json` descriptor from that MCP server’s `tools/list`.

#### Scenario: Import a local stdio MCP server
- **WHEN** a user runs the import command with a stdio command/args
- **THEN** the gateway connects to the MCP server, reads `tools/list`, generates `aai.json`, and records the integration in the local registry

#### Scenario: Import a remote MCP server
- **WHEN** a user runs the import command with a remote MCP URL transport such as `streamable-http` or `sse`
- **THEN** the gateway connects to the remote MCP server, reads `tools/list`, generates `aai.json`, and records the integration in the local registry

### Requirement: Generated descriptor content
The generated `aai.json` descriptor SHALL include:
- A stable `app.id` for the imported MCP server
- `tools[]` entries mapped 1:1 from MCP `tools/list` (name, description, input schema)
- An `execution` binding with:
  - `via: "mcp"`
  - `transport.type` and transport-specific connection fields
  - optional `launch` fields for local `stdio` servers

#### Scenario: Tool list is mapped without renaming
- **WHEN** the MCP server returns tools with names and `inputSchema`
- **THEN** the generated descriptor includes tools with the same names and schemas under `tools[]`

### Requirement: No plaintext secrets in generated descriptors
If importing a remote MCP server requires credentials (e.g., authorization headers), the import flow SHALL store secrets in the gateway’s secure storage and SHALL NOT write plaintext secrets into the generated `aai.json` descriptor or registry files.

#### Scenario: Import includes an auth token
- **WHEN** a user provides an authorization token for a remote MCP server during import
- **THEN** the token is stored in secure storage and does not appear in any on-disk JSON files

### Requirement: Registry-backed loading into `tools/list`
On gateway startup, the gateway SHALL load imported MCP server entries from the local registry and SHALL expose each imported MCP server as a single `app:<app.id>` entry in `tools/list`.

#### Scenario: Imported MCP server appears as one app entry
- **WHEN** the gateway starts after an MCP server has been imported
- **THEN** `tools/list` includes exactly one `app:<id>` entry for that imported MCP server

### Requirement: Operation guide from imported descriptor
When a client calls `app:<id>` for an imported MCP-backed app, the gateway SHALL return an operation guide that enumerates the available tool names and provides `aai:exec` call examples for each tool.

#### Scenario: App guide shows imported tools
- **WHEN** a client calls `app:<id>` for an imported MCP server
- **THEN** the response includes a list of the imported tools and example `aai:exec` invocations

### Requirement: Refresh imported MCP tools
The gateway SHALL provide a way to refresh an imported MCP integration such that:
- the gateway re-queries the MCP server `tools/list`
- the generated `aai.json` is updated while preserving the stable `app.id`

#### Scenario: Refresh updates tool list while keeping app id
- **WHEN** a user triggers a refresh for an imported MCP server
- **THEN** the gateway updates the stored descriptor’s `tools[]` to match the current MCP `tools/list` and keeps `app.id` unchanged
