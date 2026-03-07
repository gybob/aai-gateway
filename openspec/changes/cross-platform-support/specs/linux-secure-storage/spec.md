## ADDED Requirements

### Requirement: Linux secure storage

The system SHALL store credentials securely on Linux using libsecret (secret-tool).

#### Scenario: Store credential

- **WHEN** system needs to store a secret (token, password)
- **THEN** system stores it via `secret-tool store` under `aai-gateway` label

#### Scenario: Retrieve credential

- **WHEN** system needs to retrieve a stored secret
- **THEN** system reads it via `secret-tool search`
- **AND** returns the value or null if not found

#### Scenario: Delete credential

- **WHEN** system needs to remove a stored secret
- **THEN** system clears it via `secret-tool clear`
- **AND** silently succeeds if credential doesn't exist

#### Scenario: secret-tool not available

- **WHEN** `secret-tool` command is not found
- **THEN** system throws INTERNAL_ERROR with message explaining libsecret requirement
