# Changelog

## [0.1.1] - 2026-03-01

### Changed

- **BREAKING**: Implemented `tools/list` MCP method. All discovered app tools are now exposed via standard MCP `tools/list` for better client compatibility. Removed progressive discovery approach.

## [0.1.0] - 2026-02-07

### Added

- Core MCP Server implementation.
- macOS Automation support (AppleScript/JXA).
- Web UI for management and history.
- AI-powered configuration generation.
- CLI commands: `--scan`, `--generate`.
- Retry mechanism for automation calls.
