# Changelog

## [0.3.1] - 2026-03-07

### Fixed

- Fixed version display: CLI now reads version from package.json dynamically instead of hardcoded value


## [0.1.5] - 2026-03-01

### Fixed

- Fixed Apple Events parameter key mismatch: now uses `keyDirectObject` instead of `kfil` for IPC requests, aligning with AAI protocol specification and Apple Events conventions


## [0.1.4] - 2026-03-01

### Added

- Internationalization (i18n) support for consent dialogs
  - Added locale detection via `src/utils/locale.ts`
  - Support for English (`en`), Simplified Chinese (`zh-CN`), Traditional Chinese (`zh-TW`)
  - Consent dialogs now display in system language

## [0.1.1] - 2026-03-01

- **BREAKING**: Implemented `tools/list` MCP method. All discovered app tools are now exposed via standard MCP `tools/list` for better client compatibility. Removed progressive discovery approach.

## [0.1.0] - 2026-02-07

### Added

- Core MCP Server implementation.
- macOS Automation support (AppleScript/JXA).
- Web UI for management and history.
- AI-powered configuration generation.
- CLI commands: `--scan`, `--generate`.
- Retry mechanism for automation calls.
