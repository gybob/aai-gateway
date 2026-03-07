## ADDED Requirements

### Requirement: Windows secure storage

The system SHALL store credentials securely on Windows using Windows Credential Manager.

#### Scenario: Store credential

- **WHEN** system needs to store a secret (token, password)
- **THEN** system stores it in Windows Credential Manager under `aai-gateway/{account}`

#### Scenario: Retrieve credential

- **WHEN** system needs to retrieve a stored secret
- **THEN** system reads it from Windows Credential Manager
- **AND** returns the value or null if not found

#### Scenario: Delete credential

- **WHEN** system needs to remove a stored secret
- **THEN** system deletes it from Windows Credential Manager
- **AND** silently succeeds if credential doesn't exist
