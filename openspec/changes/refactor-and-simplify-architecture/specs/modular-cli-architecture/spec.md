## ADDED Requirements

### Requirement: CLI commands are modular and independently testable
Each CLI command MUST be implemented as a separate module implementing the `Command` interface, allowing independent testing and maintenance.

#### Scenario: Command implements Command interface
- **GIVEN** a command module is created
- **WHEN** the command implements the `Command` interface
- **THEN** the command provides `name`, `description`, `parse()`, and `execute()` methods
- **AND** can be registered in the command registry

#### Scenario: Command parsing is encapsulated
- **GIVEN** a command is defined
- **WHEN** the `parse(args)` method is called
- **THEN** the command parses its specific arguments
- **AND** returns a `CommandOptions` object with parsed values
- **AND** parsing errors are thrown with clear messages

#### Scenario: Command execution is isolated
- **GIVEN** a command is registered
- **WHEN** the `execute(options)` method is called
- **THEN** the command executes its logic independently
- **AND** does not depend on other commands
- **AND** can be tested in isolation

### Requirement: ArgumentParser provides unified parsing framework
The CLI MUST use a centralized `ArgumentParser` class to handle argument definitions and parsing, eliminating repetitive parsing logic across commands.

#### Scenario: Define argument
- **GIVEN** an ArgumentParser is created
- **WHEN** `define(def)` is called with an argument definition
- **THEN** the argument is registered with the parser
- **AND** includes name, type, required flag, default value, and description

#### Scenario: Parse string argument
- **GIVEN** a string argument is defined
- **WHEN** the parser encounters `--arg value` in args
- **THEN** the parsed result includes `arg: "value"`
- **AND** missing required arguments throw an error

#### Scenario: Parse array argument
- **GIVEN** an array argument is defined
- **WHEN** the parser encounters `--arg value1 --arg value2` in args
- **THEN** the parsed result includes `arg: ["value1", "value2"]`
- **AND** the array can be empty if not provided

#### Scenario: Parse object argument
- **GIVEN** an object argument is defined
- **WHEN** the parser encounters `--arg key=value` in args
- **THEN** the parsed result includes `arg: { key: "value" }`
- **AND** multiple key-value pairs are merged

#### Scenario: Parse flag argument
- **GIVEN** a flag argument is defined
- **WHEN** the parser encounters `--flag` in args
- **THEN** the parsed result includes `flag: true`
- **AND** missing flags use the default value (typically false)

#### Scenario: Use default values
- **GIVEN** an argument is defined with a default value
- **WHEN** the argument is not provided
- **THEN** the parsed result uses the default value
- **AND** required arguments still throw an error if missing

### Requirement: Command registry manages all CLI commands
The CLI MUST use a centralized command registry to manage all available commands and provide uniform command lookup and execution.

#### Scenario: Register command
- **GIVEN** a command implements the `Command` interface
- **WHEN** `registry.register(command)` is called
- **THEN** the command is stored in the registry
- **AND** can be retrieved by name

#### Scenario: Execute command through registry
- **GIVEN** a command is registered
- **WHEN** the registry receives a command name and arguments
- **THEN** the registry retrieves the appropriate command
- **AND** calls its `parse()` method
- **AND** calls its `execute()` method with the parsed options
- **AND** returns the result

#### Scenario: Unknown command error
- **GIVEN** an unknown command name is provided
- **WHEN** the registry attempts to execute the command
- **THEN** the registry throws an error
- **AND** includes the command name and a list of available commands

### Requirement: CLI supports common options across all commands
All CLI commands MUST support common options such as `--dev`, `--help`, and `--version`, providing consistent behavior across the CLI.

#### Scenario: Common dev option
- **GIVEN** any command is executed
- **WHEN** `--dev` flag is provided
- **THEN** the command's `CommandOptions` includes `dev: true`
- **AND** the command can use this to enable development mode

#### Scenario: Common help option
- **GIVEN** any command is executed
- **WHEN** `--help` or `-h` flag is provided
- **THEN** the CLI displays help information
- **AND** does not execute the command

#### Scenario: Common version option
- **GIVEN** the CLI is invoked
- **WHEN** `--version` flag is provided
- **THEN** the CLI displays the version number
- **AND** exits without executing any command

### Requirement: CLI provides clear error messages
All CLI errors MUST include clear, actionable messages that help users understand what went wrong and how to fix it.

#### Scenario: Missing required argument
- **GIVEN** a command is executed without a required argument
- **WHEN** parsing fails
- **THEN** the error message identifies the missing argument
- **AND** shows the expected format
- **AND** includes the command's help text

#### Scenario: Invalid argument value
- **GIVEN** a command is executed with an invalid argument value
- **WHEN** parsing fails
- **THEN** the error message identifies the argument
- **AND** explains why the value is invalid
- **AND** shows valid options if applicable

#### Scenario: Command execution error
- **GIVEN** a command is executed
- **WHEN** an error occurs during execution
- **THEN** the error message includes context about what failed
- **AND** suggests possible solutions if available
- **AND** includes a stack trace in dev mode

### Requirement: CLI commands are independently testable
Each CLI command MUST have comprehensive unit tests that can be run independently, ensuring reliability and maintainability.

#### Scenario: Unit test command parsing
- **GIVEN** a command module
- **WHEN** unit tests are run
- **THEN** the `parse()` method is tested with various argument combinations
- **AND** valid inputs produce correct parsed results
- **AND** invalid inputs throw appropriate errors

#### Scenario: Unit test command execution
- **GIVEN** a command module
- **WHEN** unit tests are run
- **THEN** the `execute()` method is tested with various options
- **AND** successful execution produces correct results
- **AND** error conditions are handled properly

#### Scenario: Mock external dependencies
- **GIVEN** a command depends on external services
- **WHEN** unit tests are run
- **THEN** external dependencies are mocked
- **AND** tests focus on command logic, not external behavior
