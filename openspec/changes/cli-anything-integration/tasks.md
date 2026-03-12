## 1. Type Definitions

- [x] 1.1 Add `CliExecution` interface to `src/types/aai-json.ts`
- [x] 1.2 Add type guard `isCliExecution()` for CLI execution type

## 2. CLI Executor Implementation

- [x] 2.1 Create `src/executors/cli.ts` with `CliExecutor` class
- [x] 2.2 Implement `execute()` method with subprocess spawning
- [x] 2.3 Implement JSON output parsing with error handling
- [x] 2.4 Implement timeout handling (default 120s)
- [x] 2.5 Implement `getDescriptor()` method for `--aai` retrieval
- [x] 2.6 Add singleton instance and `getCliExecutor()` function
- [x] 2.7 Write unit tests in `src/executors/cli.test.ts`

## 3. CLI Registry Implementation

- [x] 3.1 Create `src/discovery/cli-registry.ts` with `scanCliTools()` function
- [x] 3.2 Implement PATH directory scanning with cross-platform support
- [x] 3.3 Implement `cli-anything-*` pattern matching
- [x] 3.4 Implement descriptor retrieval via `--aai` command
- [x] 3.5 Extract app metadata from descriptor (app.id, app.name, etc.)
- [x] 3.6 Write unit tests in `src/discovery/cli-registry.test.ts`

## 4. Integration

- [x] 4.1 Update `src/discovery/index.ts` to include CLI tool scanning
- [x] 4.2 Update `src/mcp/server.ts` to route CLI execution type to `CliExecutor`
- [x] 4.3 Update `src/types/aai-json.ts` execution type union to include `'cli'`

## 5. Testing & Documentation

- [x] 5.1 Create mock CLI tool for integration testing
- [x] 5.2 Add integration tests for full discovery → execution flow
- [x] 5.3 Update README.md with CLI tool support documentation
- [x] 5.4 Run full test suite and fix any issues
