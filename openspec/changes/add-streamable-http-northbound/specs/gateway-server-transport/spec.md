## ADDED Requirements

### Requirement: AAI Gateway can serve MCP over streamable HTTP
AAI Gateway SHALL expose its northbound MCP server over `streamable-http` so AI tools connect to one local HTTP endpoint instead of a stdio child process.

#### Scenario: Gateway starts in streamable HTTP mode
- **WHEN** the user starts AAI Gateway with streamable HTTP serving enabled
- **THEN** the gateway binds the configured local HTTP listener and accepts MCP client connections through that endpoint

### Requirement: AAI Gateway no longer exposes northbound stdio
AAI Gateway SHALL remove the old northbound stdio server bootstrap and SHALL use `streamable-http` as the supported upstream MCP transport.

#### Scenario: Gateway starts after the northbound transport migration
- **WHEN** the gateway server is started after this change
- **THEN** it serves upstream MCP traffic through `streamable-http` rather than a stdio server transport

### Requirement: One streamable HTTP listener supports concurrent AI clients
AAI Gateway SHALL allow multiple AI tools to connect concurrently to the same northbound `streamable-http` endpoint without requiring a dedicated port per client.

#### Scenario: Two AI tools connect to one gateway instance
- **WHEN** two MCP clients connect to the same running gateway HTTP endpoint
- **THEN** the gateway serves both clients concurrently through the same listener

### Requirement: Runtime state is isolated per connected client
AAI Gateway SHALL isolate connected-client runtime state so one AI tool cannot observe or reuse another client's caller identity or downstream session state.

#### Scenario: Caller identity is scoped to one client
- **WHEN** two different AI tools initialize separate connections to the same gateway instance
- **THEN** authorization and runtime behavior for each request use the caller identity associated with that specific client connection

#### Scenario: Downstream runtime state is not shared across clients
- **WHEN** two different AI tools execute operations against the same discovered app
- **THEN** the gateway keeps their runtime session state isolated instead of reusing one shared client-global session
