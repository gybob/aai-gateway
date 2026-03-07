## ADDED Requirements

### Requirement: Windows consent dialog

The system SHALL display consent prompts on Windows using PowerShell with System.Windows.Forms.

#### Scenario: Show consent dialog

- **WHEN** user consent is required for a tool
- **THEN** system displays a MessageBox with app name, tool name, description
- **AND** dialog has "Authorize Once", "Authorize All", "Deny" buttons

#### Scenario: User authorizes once

- **WHEN** user clicks "Authorize Once"
- **THEN** system returns `{ decision: "tool", remember: false }`

#### Scenario: User denies

- **WHEN** user clicks "Deny" or closes dialog
- **THEN** system returns `{ decision: "deny", remember: false }`

#### Scenario: User authorizes all

- **WHEN** user clicks "Authorize All"
- **THEN** system returns `{ decision: "all", remember: true }`
