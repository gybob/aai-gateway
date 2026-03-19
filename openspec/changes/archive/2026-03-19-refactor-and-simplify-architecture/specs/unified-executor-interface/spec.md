## ADDED Requirements

### Requirement: All executors implement a unified interface
All executor implementations MUST implement the `Executor<TConfig, TDetail>` interface, providing consistent methods for connection lifecycle, capability discovery, execution, and health checking.

#### Scenario: Executor implements connect method
- **GIVEN** an executor implements the unified interface
- **WHEN** the gateway calls `connect(localId, config)`
- **THEN** the executor establishes a connection to the target system
- **AND** the executor maintains the connection state for subsequent operations

#### Scenario: Executor implements disconnect method
- **GIVEN** an executor has an active connection
- **WHEN** the gateway calls `disconnect(localId)`
- **THEN** the executor cleanly terminates the connection
- **AND** releases any associated resources

#### Scenario: Executor implements loadDetail method
- **GIVEN** an executor implements the unified interface
- **WHEN** the gateway calls `loadDetail(config)`
- **THEN** the executor loads and returns detailed capability information
- **AND** the detail format is appropriate for the protocol family

#### Scenario: Executor implements execute method
- **GIVEN** an executor has an active connection
- **WHEN** the gateway calls `execute(localId, config, operation, args)`
- **THEN** the executor executes the specified operation with the provided arguments
- **AND** returns an `ExecutionResult` with success status and data or error

#### Scenario: Executor implements health method
- **GIVEN** an executor implements the unified interface
- **WHEN** the gateway calls `health(localId)`
- **THEN** the executor checks the connection state
- **AND** returns `true` if the connection is healthy, `false` otherwise

### Requirement: ExecutorRegistry manages all executor instances
The gateway MUST use a centralized `ExecutorRegistry` to manage all executor instances and provide uniform access to executors based on protocol.

#### Scenario: Register an executor
- **GIVEN** an executor implements the unified interface
- **WHEN** the gateway calls `registry.register(protocol, executor)`
- **THEN** the executor is stored in the registry under the specified protocol
- **AND** can be retrieved later using `registry.get(protocol)`

#### Scenario: Execute through registry
- **GIVEN** an executor is registered in the registry
- **WHEN** the gateway calls `registry.execute(protocol, localId, config, operation, args)`
- **THEN** the registry retrieves the appropriate executor
- **AND** delegates the execution to that executor
- **AND** returns the execution result

#### Scenario: Unknown protocol error
- **GIVEN** an attempt is made to execute with an unknown protocol
- **WHEN** the gateway calls `registry.execute(protocol, ...)`
- **THEN** the registry throws an `EXECUTOR_NOT_FOUND` error
- **AND** includes the protocol name in the error message

### Requirement: ExecutionResult provides consistent response format
All executor executions MUST return an `ExecutionResult` object with a standardized structure containing success status, optional data, and optional error information.

#### Scenario: Successful execution
- **GIVEN** an executor successfully completes an operation
- **WHEN** the execute method returns
- **THEN** `ExecutionResult.success` is `true`
- **AND** `ExecutionResult.data` contains the operation result
- **AND** `ExecutionResult.error` is `undefined`

#### Scenario: Failed execution
- **GIVEN** an executor fails to complete an operation
- **WHEN** the execute method returns or throws
- **THEN** `ExecutionResult.success` is `false`
- **AND** `ExecutionResult.error` contains a descriptive error message
- **AND** `ExecutionResult.data` may contain partial results if available

### Requirement: Executors support type-safe configuration
Each executor MUST define its own configuration type (`TConfig`) and detail type (`TDetail`), ensuring type safety when working with protocol-specific data.

#### Scenario: MCP executor with typed config
- **GIVEN** the MCP executor defines `McpConfig` type
- **WHEN** the executor is used with an `McpConfig` object
- **THEN** TypeScript ensures the configuration structure is correct
- **AND** invalid configurations are caught at compile time

#### Scenario: Skill executor with typed config
- **GIVEN** the skill executor defines `SkillConfig` type
- **WHEN** the executor is used with a `SkillConfig` object
- **THEN** TypeScript ensures the configuration structure is correct
- **AND** invalid configurations are caught at compile time
