# Changelog

## [0.4.0] - 2026-03-19

### Added

- **Discovery Manager**: Unified discovery framework for managing multiple discovery sources
  - `DiscoveryManager` class with priority-based source registration
  - Automatic result caching with configurable TTL
  - Support for forced refresh and per-source cache management
  - `createDiscoveryManager()` helper for easy setup with standard sources

- **Discovery Sources**: Modular discovery source implementations
  - `DesktopDiscoverySource`: Discovers desktop apps (macOS, Windows, Linux)
  - `AgentDiscoverySource`: Discovers ACP agents
  - `ManagedDiscoverySource`: Discovers gateway-managed apps

- **Unified Storage**: Refactored storage architecture
  - `FileRegistry<T>`: Generic file-based registry implementation
  - `SimpleCache<T>`: In-memory cache with TTL support
  - `McpRegistry`: Unified MCP server registry
  - `SkillRegistry`: Unified skill registry
  - `ManagedRegistry`: Gateway-managed app registry

- **Storage Module**: Centralized storage exports via `src/storage/index.ts`
  - All storage types and implementations in one place
  - Consistent API for all storage operations

### Changed

- **Server Architecture**: Migrated from direct discovery calls to DiscoveryManager
  - Cleaner separation of concerns
  - Better testability with mockable sources
  - Improved caching strategy

- **Registry API**: Updated registries to use `FileRegistry<T>` base class
  - Consistent API across all registries
  - Better type safety
  - Easier to maintain and extend

### Removed

- Deprecated `managed-descriptors.ts`: Functionality moved to `ManagedRegistry`
- Unused `name-cache.ts`: No longer used in codebase

### Internal

- Updated TypeScript types for better type safety
- Improved test coverage for new discovery and storage modules
- All 113 tests passing
- Backward compatibility maintained for existing APIs

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
