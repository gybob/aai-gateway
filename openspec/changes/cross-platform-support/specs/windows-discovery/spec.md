## ADDED Requirements

### Requirement: Windows application discovery

The system SHALL discover AAI-enabled applications on Windows by scanning standard installation directories for `aai.json` files.

#### Scenario: Discover app in Program Files

- **WHEN** an application is installed in `C:\Program Files\MyApp\` with `aai.json`
- **THEN** system finds and parses the descriptor
- **AND** system returns app with platform set to "windows"

#### Scenario: Discover app in AppData

- **WHEN** a user-installed application is in `%LOCALAPPDATA%\Programs\MyApp\` with `aai.json`
- **THEN** system finds and parses the descriptor

#### Scenario: Skip non-Windows apps

- **WHEN** discovered `aai.json` has `platform: "macos"`
- **THEN** system SHALL NOT include it in Windows discovery results
