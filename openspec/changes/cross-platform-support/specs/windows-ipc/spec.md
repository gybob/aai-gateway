## ADDED Requirements

### Requirement: Windows IPC execution

The system SHALL execute desktop app operations on Windows using PowerShell and COM automation.

#### Scenario: Execute tool via COM

- **WHEN** agent calls a tool on a Windows app
- **THEN** system invokes the tool via COM object method
- **AND** system returns the result as JSON

#### Scenario: Handle COM timeout

- **WHEN** COM call exceeds 30 seconds
- **THEN** system throws TIMEOUT error

#### Scenario: Handle COM error

- **WHEN** COM object returns an error
- **THEN** system throws INTERNAL_ERROR with the error message
