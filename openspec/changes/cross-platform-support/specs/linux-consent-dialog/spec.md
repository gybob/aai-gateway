## ADDED Requirements

### Requirement: Linux consent dialog

The system SHALL display consent prompts on Linux using zenity or kdialog.

#### Scenario: Show consent dialog with zenity

- **WHEN** user consent is required and zenity is available
- **THEN** system displays a zenity question dialog with app name, tool name, description
- **AND** dialog has "Authorize" and "Deny" buttons

#### Scenario: Show consent dialog with kdialog

- **WHEN** user consent is required and kdialog is available (but not zenity)
- **THEN** system displays a kdialog yes/no dialog

#### Scenario: No dialog tool available

- **WHEN** neither zenity nor kdialog is installed
- **THEN** system throws INTERNAL_ERROR with message explaining requirement

#### Scenario: User authorizes

- **WHEN** user clicks "Authorize" or "Yes"
- **THEN** system returns `{ decision: "tool", remember: false }`

#### Scenario: User denies

- **WHEN** user clicks "Deny", "No", or closes dialog
- **THEN** system returns `{ decision: "deny", remember: false }`
