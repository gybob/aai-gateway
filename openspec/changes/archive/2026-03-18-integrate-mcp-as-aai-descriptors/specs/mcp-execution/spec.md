## ADDED Requirements

### Requirement: MCP execution binding
AAI Gateway SHALL support `aai.json` descriptors whose `execution.via` is `mcp`, representing an application whose tools are executed by forwarding to an external MCP server.

#### Scenario: Descriptor declares MCP execution
- **WHEN** a descriptor is loaded with `execution.via: "mcp"`
- **THEN** the gateway treats the descriptor as an MCP-backed app for `aai:exec` execution

### Requirement: Supported MCP transports
For `execution.via: "mcp"`, the descriptor SHALL declare `execution.transport.type`, and the gateway SHALL support executing via:
- `stdio` (spawn a local MCP server process and communicate over stdin/stdout)
- `streamable-http` (connect to a remote MCP server using the current MCP HTTP transport)
- `sse` (connect to a remote MCP server using the legacy SSE-based transport when available)

#### Scenario: STDIO transport is configured
- **WHEN** an MCP-backed descriptor specifies `transport.type: "stdio"` and a `launch` block
- **THEN** the gateway can start the MCP server process and execute tools against it

#### Scenario: Streamable HTTP transport is configured
- **WHEN** an MCP-backed descriptor specifies `transport.type: "streamable-http"` with a URL
- **THEN** the gateway can connect to the remote MCP server and execute tools against it

#### Scenario: Legacy SSE transport is configured
- **WHEN** an MCP-backed descriptor specifies `transport.type: "sse"` with a URL
- **THEN** the gateway can connect to the remote MCP server and execute tools against it

### Requirement: Execution authentication stays outside `execution`
If an MCP-backed descriptor requires credentials for a remote transport, the descriptor SHALL define credential acquisition under `auth`, and SHALL NOT embed plaintext secrets in `execution.transport`.

#### Scenario: Remote MCP descriptor requires a bearer token
- **WHEN** a descriptor declares a remote MCP transport and API-key style authentication
- **THEN** the token is obtained via `auth` and injected by the gateway at runtime rather than stored in `execution.transport`

### Requirement: Forward `aai:exec` to MCP `tools/call`
When executing an MCP-backed descriptor, the gateway SHALL forward `aai:exec({ app, tool, args })` by issuing an MCP `tools/call` request to the configured MCP server with:
- `name` = `tool`
- `arguments` = `args` (or `{}` when omitted)

#### Scenario: Execute a tool with arguments
- **WHEN** a client calls `aai:exec` for an MCP-backed app with `tool` and `args`
- **THEN** the gateway forwards the call to MCP `tools/call` using the same tool name and arguments

### Requirement: Consent enforcement for MCP-backed tools
Before forwarding `aai:exec` to MCP for an MCP-backed descriptor, the gateway SHALL apply the same per-caller consent policy used for other app types, keyed by `(callerIdentity, app.id, tool.name)`.

#### Scenario: First-time call prompts for consent
- **WHEN** a caller executes an MCP-backed tool for the first time
- **THEN** the gateway prompts for consent and only forwards to MCP after approval

### Requirement: Lazy connection and reuse
The gateway SHALL establish an MCP connection (or start the stdio process) lazily on first use for each MCP-backed app, and SHALL reuse the connection for subsequent executions until it becomes unusable.

#### Scenario: Connection is created on first execution
- **WHEN** an MCP-backed app is present in the registry but no tool has been executed yet
- **THEN** the gateway does not connect until the first `aai:exec` call for that app

### Requirement: Fault handling and restart
If an MCP stdio process exits or a remote MCP connection drops, the gateway SHALL treat the MCP server as unavailable for that app and SHALL attempt to re-establish connectivity on the next execution attempt.

#### Scenario: Stdio process crashes between calls
- **WHEN** an MCP stdio process exits unexpectedly after a successful execution
- **THEN** the next `aai:exec` attempt causes the gateway to restart the process and retry execution (subject to timeouts)

### Requirement: Error mapping
If the MCP server returns an MCP error for `tools/call`, the gateway SHALL return an error to the MCP client that includes the MCP error message and preserves diagnostic information where safe.

#### Scenario: MCP tool call fails
- **WHEN** the MCP server responds to `tools/call` with an error
- **THEN** the gateway returns an execution error that includes the MCP error message
