## ADDED Requirements

### Requirement: All discovery sources implement a unified interface
Each discovery source MUST implement the `DiscoverySource` interface, providing consistent methods for scanning apps and optional caching support.

#### Scenario: DiscoverySource implements scan method
- **GIVEN** a discovery source implements the unified interface
- **WHEN** the gateway calls `source.scan(options)`
- **THEN** the source scans for apps according to its protocol
- **AND** returns an array of `RuntimeAppRecord` objects
- **AND** each record includes localId, descriptor, source, and location

#### Scenario: DiscoverySource provides name and priority
- **GIVEN** a discovery source implements the unified interface
- **WHEN** the source is inspected
- **THEN** `source.name` identifies the discovery source
- **AND** `source.priority` defines its execution order (higher priority first)

#### Scenario: DiscoverySource supports optional caching
- **GIVEN** a discovery source implements the unified interface
- **WHEN** the gateway calls `source.shouldCache()`
- **THEN** the source indicates whether it supports caching
- **AND** if true, `source.getCacheKey()` returns a unique cache key

### Requirement: DiscoveryManager coordinates all discovery sources
The gateway MUST use a centralized `DiscoveryManager` to coordinate all discovery sources, providing uniform scanning and caching.

#### Scenario: Register discovery source
- **GIVEN** a discovery source implements the unified interface
- **WHEN** `manager.register(source)` is called
- **THEN** the source is added to the manager
- **AND** sources are automatically sorted by priority

#### Scenario: Scan all sources
- **GIVEN** multiple discovery sources are registered
- **WHEN** `manager.scanAll(options)` is called
- **THEN** the manager scans all sources in priority order
- **AND** returns combined results from all sources
- **AND** handles failures gracefully (continues with other sources)

#### Scenario: Source failure is logged
- **GIVEN** a discovery source fails during scan
- **WHEN** the failure occurs
- **THEN** the manager logs the error with source name
- **AND** continues scanning other sources
- **AND** does not include failed source in results

#### Scenario: Cache is used when available
- **GIVEN** a discovery source supports caching
- **WHEN** `manager.scanAll(options)` is called
- **THEN** the manager checks the cache first
- **AND** returns cached results if available and valid
- **AND** scans the source only if cache is missed

#### Scenario: Cache is updated after scan
- **GIVEN** a discovery source supports caching
- **WHEN** the source is successfully scanned
- **THEN** the manager stores results in cache
- **AND** associates results with the source's cache key
- **AND** cache is used for subsequent scans

### Requirement: Discovery sources handle platform-specific logic
Each discovery source MUST encapsulate platform-specific logic for its app type, providing a clean abstraction to the rest of the system.

#### Scenario: DesktopDiscoverySource scans desktop apps
- **GIVEN** the DesktopDiscoverySource is registered
- **WHEN** `scan(options)` is called
- **THEN** the source scans desktop app directories
- **AND** loads descriptors from known locations
- **AND** returns RuntimeAppRecord objects with source='desktop'
- **AND** supports caching with cache key 'desktop:apps'

#### Scenario: AgentDiscoverySource scans ACP agents
- **GIVEN** the AgentDiscoverySource is registered
- **WHEN** `scan(options)` is called
- **THEN** the source scans for installed ACP agents
- **AND** generates descriptors for discovered agents
- **AND** returns RuntimeAppRecord objects with source='acp-agent'
- **AND** does not support caching (agents can change)

#### Scenario: ManagedDiscoverySource scans managed descriptors
- **GIVEN** the ManagedDiscoverySource is registered
- **WHEN** `scan(options)` is called
- **THEN** the source loads managed descriptor files
- **AND** parses and validates each descriptor
- **AND** returns RuntimeAppRecord objects from all managed sources
- **AND** supports caching with cache key 'managed:descriptors'

### Requirement: Discovery results are deduplicated
The discovery manager MUST deduplicate apps with the same localId, giving priority to higher-priority sources.

#### Scenario: Deduplicate by localId
- **GIVEN** multiple sources discover the same app (same localId)
- **WHEN** `manager.scanAll(options)` is called
- **THEN** only one entry is included in results
- **AND** the entry comes from the highest-priority source
- **AND** lower-priority sources are ignored for that localId

### Requirement: Discovery supports configurable options
All discovery sources MUST accept optional `DiscoveryOptions` to customize behavior, such as dev mode or specific paths.

#### Scenario: Scan with dev mode
- **GIVEN** a discovery source is registered
- **WHEN** `scan({ devMode: true })` is called
- **THEN** the source includes dev-only apps in results
- **AND** may use dev-specific paths or configurations

#### Scenario: Scan with custom paths
- **GIVEN** a discovery source supports custom paths
- **WHEN** `scan({ paths: ['/custom/path'] })` is called
- **THEN** the source scans only the specified paths
- **AND** does not scan default locations

### Requirement: Discovery provides consistent error handling
All discovery sources MUST handle errors consistently, logging failures and not crashing the discovery process.

#### Scenario: Source throws error during scan
- **GIVEN** a discovery source encounters an error
- **WHEN** the error is thrown
- **THEN** the source catches and logs the error
- **AND** returns an empty array (not null/undefined)
- **AND** does not propagate the error to the manager

#### Scenario: Invalid descriptor is encountered
- **GIVEN** a discovery source finds an invalid descriptor
- **WHEN** parsing fails
- **THEN** the source logs the error with file path
- **AND** skips the invalid descriptor
- **AND** continues scanning other descriptors

### Requirement: Discovery sources are independently testable
Each discovery source MUST have comprehensive unit tests that can be run independently, ensuring reliability and maintainability.

#### Scenario: Unit test discovery source
- **GIVEN** a discovery source module
- **WHEN** unit tests are run
- **THEN** the `scan()` method is tested with various inputs
- **AND** caching behavior is tested if supported
- **AND** error handling is tested
- **AND** results are validated against expected structure

#### Scenario: Mock file system for testing
- **GIVEN** a discovery source reads from the file system
- **WHEN** unit tests are run
- **THEN** file system access is mocked
- **AND** tests focus on discovery logic, not file I/O
