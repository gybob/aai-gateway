## ADDED Requirements

### Requirement: Linux application discovery

The system SHALL discover AAI-enabled applications on Linux by scanning XDG desktop entry directories.

#### Scenario: Discover app from desktop entry

- **WHEN** a `.desktop` file in `/usr/share/applications/` contains `X-AAI-Config=/path/to/aai.json`
- **THEN** system reads and parses the referenced `aai.json`
- **AND** system returns app with platform set to "linux"

#### Scenario: Discover user-installed app

- **WHEN** a `.desktop` file in `~/.local/share/applications/` references an `aai.json`
- **THEN** system discovers the app

#### Scenario: Skip non-Linux apps

- **WHEN** discovered `aai.json` has `platform: "macos"` or `platform: "windows"`
- **THEN** system SHALL NOT include it in Linux discovery results
