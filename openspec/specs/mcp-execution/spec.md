## MODIFIED Requirements

### Requirement: MCP-backed apps are declared through access metadata
AAI Gateway SHALL support descriptors whose `access.protocol` is `mcp`.

#### Scenario: Descriptor declares MCP access
- **WHEN** a descriptor declares `access.protocol: "mcp"`
- **THEN** the gateway treats the app as MCP-backed

### Requirement: MCP config supports the current transport set
For `access.protocol: "mcp"`, the descriptor SHALL declare MCP connection metadata for one of:
- `stdio`
- `streamable-http`
- `sse`

#### Scenario: Local stdio MCP server is configured
- **WHEN** the descriptor config declares a stdio MCP server command
- **THEN** the gateway can launch the process and communicate over stdio

#### Scenario: Remote streamable-http MCP server is configured
- **WHEN** the descriptor config declares a `streamable-http` URL
- **THEN** the gateway can connect to the remote MCP server

#### Scenario: Legacy SSE MCP server is configured
- **WHEN** the descriptor config declares an `sse` URL
- **THEN** the gateway can connect to the remote MCP server

### Requirement: MCP layer-3 detail is loaded natively
For MCP-backed apps, the gateway SHALL load layer-3 detail from MCP-native discovery and SHALL NOT require the descriptor to embed the native tool list.

#### Scenario: MCP details are requested
- **WHEN** the agent requests detailed capability information for an MCP-backed app
- **THEN** the gateway loads that detail from MCP-native discovery

### Requirement: MCP execution routes through MCP tools
When executing an MCP-backed app, the gateway SHALL dispatch through MCP using the configured server connection.

#### Scenario: `aai:exec` reaches an MCP-backed app
- **WHEN** a client calls `aai:exec` for an MCP-backed app
- **THEN** the gateway executes the request through the MCP executor
