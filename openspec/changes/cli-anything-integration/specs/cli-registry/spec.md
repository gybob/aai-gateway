## ADDED Requirements

### Requirement: CLI Tool Discovery via PATH Scan

The system SHALL discover CLI tools by scanning directories in the PATH environment variable.

#### Scenario: Discover cli-anything tools

- **WHEN** the system starts up
- **THEN** the system SHALL scan all directories in `$PATH`
- **AND** the system SHALL identify executables matching `cli-anything-*` pattern
- **AND** the system SHALL collect command name and path for each match

#### Scenario: Handle PATH directory access errors

- **WHEN** a PATH directory does not exist or is not readable
- **THEN** the system SHALL skip that directory
- **AND** the system SHALL continue scanning other directories

### Requirement: CLI Tool Descriptor Registration

The system SHALL register discovered CLI tools with their descriptors.

#### Scenario: Register discovered CLI tool

- **WHEN** a `cli-anything-*` command is found
- **THEN** the system SHALL execute `<command> --aai` to get descriptor
- **AND** the system SHALL register the tool in the discovery results
- **AND** the tool SHALL appear as `app:cli-anything.<name>` in tools/list

#### Scenario: Handle invalid descriptor

- **WHEN** `<command> --aai` returns invalid JSON
- **THEN** the system SHALL skip this CLI tool
- **AND** the system SHALL log a warning with the parse error

### Requirement: CLI Tool Metadata Extraction

The system SHALL extract app metadata from the descriptor returned by `--aai`.

#### Scenario: Extract app ID from descriptor

- **WHEN** `<command> --aai` returns a valid descriptor
- **THEN** the system SHALL use `descriptor.app.id` as the app ID
- **AND** the tool SHALL appear as `app:<descriptor.app.id>` in tools/list

#### Scenario: Extract display name from descriptor

- **WHEN** `<command> --aai` returns a valid descriptor
- **THEN** the system SHALL use `descriptor.app.name` for display name
- **AND** the system SHALL respect `defaultLang` for localization

### Requirement: Cross-Platform PATH Handling

The system SHALL handle PATH correctly on all platforms.

#### Scenario: Unix-like PATH separator

- **WHEN** running on macOS or Linux
- **THEN** the system SHALL split PATH by `:` (colon)

#### Scenario: Windows PATH separator

- **WHEN** running on Windows
- **THEN** the system SHALL split PATH by `;` (semicolon)
- **AND** the system SHALL handle `.exe` suffix in command matching
