## Why

AAI Gateway has evolved rapidly, and the codebase now contains several areas of complexity and redundancy that make maintenance and future development difficult:

- The CLI implementation (`src/cli.ts`) has grown to over 400 lines with repetitive command-line argument parsing logic
- Executor implementations lack a unified abstraction layer, leading to inconsistent interfaces
- Discovery mechanisms contain redundant code across platform-specific implementations
- Storage layer has multiple registry files with overlapping responsibilities
- Type definitions are scattered across multiple files
- Error handling is not standardized across the codebase

This refactoring aims to simplify the architecture, reduce redundancy, and establish clear patterns that will make the codebase easier to maintain and extend.

## What Changes

- **BREAKING** Refactor CLI into modular command handlers with a unified argument parsing framework
- **BREAKING** Introduce a unified executor interface that all executors must implement
- Consolidate discovery mechanisms to eliminate redundant code across platforms
- Simplify storage layer by merging redundant registry structures
- Consolidate type definitions into a centralized module structure
- Establish consistent error handling patterns across all components
- Improve test coverage for refactored components

## Capabilities

### New Capabilities
- `unified-executor-interface`: Defines the common interface that all executors must implement
- `modular-cli-architecture`: Defines the structure for modular CLI command handlers
- `consolidated-discovery`: Defines the unified discovery mechanism for all app sources

### Modified Capabilities
- `mcp-execution`: Update to implement the unified executor interface
- `skill-execution`: Update to implement the unified executor interface
- `acp-agent-execution`: Update to implement the unified executor interface
- `cli-execution`: Update to implement the unified executor interface

## Impact

- CLI command structure and argument handling
- Executor implementations across all protocol families
- Discovery mechanism implementation
- Storage layer architecture
- Type definition organization
- Error handling patterns
- Test suite structure and coverage
