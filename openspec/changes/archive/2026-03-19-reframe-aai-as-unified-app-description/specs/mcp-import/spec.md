## MODIFIED Requirements

### Requirement: MCP import generates minimal AAI descriptors
AAI Gateway SHALL provide an `aai-gateway ...` CLI import flow that reads MCP-native discovery information and generates a minimal AAI descriptor containing:
- `app`
- `access`
- `exposure`

#### Scenario: Import a local stdio MCP server
- **WHEN** a user imports a local stdio MCP server
- **THEN** the gateway generates a minimal descriptor and stores the integration in the local registry

#### Scenario: Import a remote MCP server
- **WHEN** a user imports a remote MCP server using `streamable-http` or `sse`
- **THEN** the gateway generates a minimal descriptor and stores the integration in the local registry

### Requirement: Imported MCP descriptors are gateway-owned
The gateway SHALL persist imported MCP integrations as gateway-owned descriptor assets rather than as references to the user's original command input only.

#### Scenario: Imported MCP integration is persisted locally
- **WHEN** an MCP server import succeeds
- **THEN** the gateway stores a generated descriptor and local registry entry for later reuse

### Requirement: MCP import collects exposure metadata
The MCP import flow SHALL ensure that the generated descriptor contains `exposure.keywords` and `exposure.summary`.

The gateway SHOULD support:
- direct CLI collection from the user
- optional agent-assisted generation from MCP-native metadata

#### Scenario: User confirms generated exposure metadata
- **WHEN** the import flow derives `keywords` and `summary` from MCP-native information
- **THEN** the user can review or override those values before the descriptor is stored

### Requirement: Imported MCP apps appear as one app entry
On startup, the gateway SHALL load imported MCP entries from the local registry and expose each imported server as a single app entry.

#### Scenario: Imported MCP app is listed once
- **WHEN** the gateway starts after an MCP server has been imported
- **THEN** the imported server appears as one app entry in baseline discovery

### Requirement: MCP refresh updates exposure metadata
The gateway SHALL support refreshing an imported MCP integration by re-reading native MCP discovery and updating the generated descriptor's exposure metadata.

#### Scenario: Refresh updates keywords and summary
- **WHEN** a user refreshes an imported MCP integration
- **THEN** the gateway updates the stored descriptor's `exposure` metadata
