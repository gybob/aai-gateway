## ADDED Requirements

### Requirement: Linux IPC execution

The system SHALL execute desktop app operations on Linux using DBus.

#### Scenario: Execute tool via DBus

- **WHEN** agent calls a tool on a Linux app
- **THEN** system invokes the tool via DBus method call
- **AND** system returns the result as JSON

#### Scenario: Handle DBus timeout

- **WHEN** DBus call exceeds 30 seconds
- **THEN** system throws TIMEOUT error

#### Scenario: Handle DBus error

- **WHEN** DBus method returns an error
- **THEN** system throws INTERNAL_ERROR with the error message

#### Scenario: DBus not available

- **WHEN** DBus session bus is not running
- **THEN** system throws INTERNAL_ERROR with message explaining DBus requirement
