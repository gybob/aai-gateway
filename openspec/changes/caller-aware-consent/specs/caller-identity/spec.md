## ADDED Requirements

### Requirement: Caller identity extraction

The system SHALL extract caller identity from MCP connection context during tool execution requests.

#### Scenario: Claude Desktop makes request

- **WHEN** Claude Desktop connects and calls a tool
- **THEN** system extracts `callerId` as "claude-desktop" from `clientInfo.name`

#### Scenario: Cursor makes request

- **WHEN** Cursor connects and calls a tool
- **THEN** system extracts `callerId` as "cursor" from `clientInfo.name`

#### Scenario: Unknown client makes request

- **WHEN** client provides no `clientInfo` or empty name
- **THEN** system uses `callerId` as "unknown"

### Requirement: Caller identity in consent context

The system SHALL include caller identity in all consent check and prompt operations.

#### Scenario: Consent check includes caller

- **WHEN** consent manager checks authorization for a tool
- **THEN** caller identity is passed as part of the consent context

#### Scenario: Consent prompt shows caller

- **WHEN** consent dialog is displayed to user
- **THEN** caller name is shown in dialog title and body
