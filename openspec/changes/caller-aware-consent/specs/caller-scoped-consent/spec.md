## ADDED Requirements

### Requirement: Per-caller consent storage

The system SHALL store consent decisions keyed by `(callerName, appId, toolName)` tuple.

#### Scenario: Store consent for specific caller

- **WHEN** user grants consent for Claude Desktop to use sendEmail tool
- **THEN** consent is stored at `consents["Claude Desktop"][appId].tools["sendEmail"]`

#### Scenario: Different caller requires new consent

- **WHEN** Cursor attempts to use sendEmail after Claude Desktop was authorized
- **THEN** system prompts for new consent (no stored consent for "Cursor")

### Requirement: Consent isolation between callers

The system SHALL NOT share consent decisions between different callers.

#### Scenario: Claude authorized, Cursor not

- **WHEN** Claude Desktop is authorized for tool X
- **AND** Cursor attempts to use tool X
- **THEN** Cursor MUST go through consent flow
