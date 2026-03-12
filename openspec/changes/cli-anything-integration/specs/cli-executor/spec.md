## ADDED Requirements

### Requirement: CLI Execution Type Support

The system SHALL support `execution.type: 'cli'` in aai.json descriptors for CLI-based applications.

#### Scenario: Valid CLI descriptor parsing

- **WHEN** a descriptor with `execution.type: 'cli'` is loaded
- **THEN** the system SHALL recognize it as a CLI application
- **AND** the system SHALL extract `command`, `jsonFlag`, and `timeout` fields

### Requirement: CLI Command Execution

The system SHALL execute CLI commands via subprocess and parse JSON output.

#### Scenario: Execute CLI tool with JSON output

- **WHEN** `aai:exec` is called with `{app: "cli-anything-gimp", tool: "project new", args: {...}}`
- **THEN** the system SHALL spawn `cli-anything-gimp --json project new` with args
- **AND** the system SHALL parse stdout as JSON
- **AND** the system SHALL return the parsed result to the caller

#### Scenario: Handle non-zero exit code

- **WHEN** a CLI command exits with non-zero code
- **THEN** the system SHALL return an error with stderr content
- **AND** the system SHALL include the exit code in error details

#### Scenario: Handle execution timeout

- **WHEN** a CLI command exceeds the timeout (default 120s)
- **THEN** the system SHALL terminate the process
- **AND** the system SHALL return a TIMEOUT error

### Requirement: CLI Descriptor Retrieval

The system SHALL support retrieving aai.json descriptor via `--aai` parameter.

#### Scenario: Get descriptor from CLI tool

- **WHEN** discovering a CLI tool
- **THEN** the system SHALL execute `<command> --aai`
- **AND** the system SHALL parse the output as aai.json descriptor

#### Scenario: Fallback if --aai not supported

- **WHEN** `<command> --aai` exits with non-zero code
- **THEN** the system SHALL skip this CLI tool
- **AND** the system SHALL log a debug message

### Requirement: JSON Output Flag Configuration

The system SHALL support configurable JSON output flag.

#### Scenario: Use custom JSON flag

- **WHEN** descriptor specifies `execution.jsonFlag: "--output=json"`
- **THEN** the system SHALL use `--output=json` instead of `--json`

#### Scenario: Use default JSON flag

- **WHEN** descriptor does not specify `jsonFlag`
- **THEN** the system SHALL use `--json` as default
