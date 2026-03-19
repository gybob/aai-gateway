# Tasks: Refactor and Simplify AAI Gateway Architecture

## Phase 1: Foundation (Week 1)

### Type Definitions
- [ ] Create `src/types/executor.ts` with executor-related types
  - [ ] Define `Executor<TConfig, TDetail>` interface
  - [ ] Define `ExecutionResult` interface
  - [ ] Define executor configuration types
- [ ] Create `src/types/discovery.ts` with discovery-related types
  - [ ] Define `DiscoverySource` interface
  - [ ] Define `DiscoveryOptions` type
  - [ ] Define `RuntimeAppRecord` type
- [ ] Create `src/types/storage.ts` with storage-related types
  - [ ] Define `Registry<T>` interface
  - [ ] Define `RegistryItem` interface
  - [ ] Define cache-related types
- [ ] Create `src/types/cli.ts` with CLI-related types
  - [ ] Define `Command` interface
  - [ ] Define `CommandOptions` type
  - [ ] Define argument parser types
- [ ] Create `src/types/index.ts` to export all types
- [ ] Write unit tests for all new type definitions

### Executor Interface
- [ ] Create `src/executors/interface.ts`
  - [ ] Define `Executor<TConfig, TDetail>` interface
  - [ ] Define `ExecutionResult` interface
- [ ] Create `src/executors/registry.ts`
  - [ ] Implement `ExecutorRegistry` class
  - [ ] Implement register() method
  - [ ] Implement get() method
  - [ ] Implement execute() method
- [ ] Write unit tests for executor interface
- [ ] Write unit tests for executor registry

### Storage Foundation
- [ ] Create `src/storage/interface.ts`
  - [ ] Define `Registry<T>` interface
  - [ ] Define `RegistryItem` interface
- [ ] Create `src/storage/registry.ts`
  - [ ] Implement `FileRegistry<T>` class
  - [ ] Implement list() method
  - [ ] Implement get() method
  - [ ] Implement upsert() method
  - [ ] Implement delete() method
- [ ] Create `src/storage/cache.ts`
  - [ ] Implement `SimpleCache<T>` class
  - [ ] Implement get() method
  - [ ] Implement set() method
  - [ ] Implement clear() method
- [ ] Write unit tests for generic registry
- [ ] Write unit tests for cache implementation

## Phase 2: CLI Refactoring (Week 2)

### CLI Framework
- [ ] Create `src/cli/parser.ts`
  - [ ] Define `ArgumentDef` interface
  - [ ] Implement `ArgumentParser` class
  - [ ] Implement define() method
  - [ ] Implement parse() method
  - [ ] Add support for flags, strings, arrays, objects
- [ ] Create `src/cli/commands/interface.ts`
  - [ ] Define `Command` interface
  - [ ] Define `CommandOptions` type
- [ ] Create `src/cli/commands/index.ts`
  - [ ] Implement command registry
  - [ ] Implement registerCommands() function
- [ ] Write unit tests for argument parser

### Command Migration
- [ ] Create `src/cli/commands/serve.ts`
  - [ ] Implement serve command
  - [ ] Add argument definitions
  - [ ] Migrate existing logic
  - [ ] Write tests
- [ ] Create `src/cli/commands/scan.ts`
  - [ ] Implement scan command
  - [ ] Add argument definitions
  - [ ] Migrate existing logic
  - [ ] Write tests
- [ ] Update `src/cli/index.ts`
  - [ ] Use new command registry
  - [ ] Replace old parsing logic
  - [ ] Update help text
- [ ] Write integration tests for new CLI

## Phase 3: Executor Migration (Week 3)

### MCP Executor
- [ ] Update `src/executors/mcp.ts`
  - [ ] Implement `Executor<McpConfig, McpDetail>` interface
  - [ ] Implement connect() method
  - [ ] Implement disconnect() method
  - [ ] Implement loadDetail() method
  - [ ] Implement execute() method
  - [ ] Implement health() method
  - [ ] Preserve existing functionality
- [ ] Write unit tests for MCP executor
- [ ] Update MCP executor tests

### Skill Executor
- [ ] Update `src/executors/skill.ts`
  - [ ] Implement `Executor<SkillConfig, SkillDetail>` interface
  - [ ] Implement connect() method (if needed)
  - [ ] Implement disconnect() method (if needed)
  - [ ] Implement loadDetail() method
  - [ ] Implement execute() method
  - [ ] Implement health() method (if needed)
  - [ ] Preserve existing functionality
- [ ] Write unit tests for skill executor
- [ ] Update skill executor tests

### ACP Executor
- [ ] Update `src/executors/acp.ts`
  - [ ] Implement `Executor<AcpConfig, AcpDetail>` interface
  - [ ] Implement connect() method
  - [ ] Implement disconnect() method
  - [ ] Implement loadDetail() method
  - [ ] Implement execute() method
  - [ ] Implement health() method
  - [ ] Preserve existing functionality
- [ ] Write unit tests for ACP executor
- [ ] Update ACP executor tests

### CLI Executor
- [ ] Update `src/executors/cli.ts`
  - [ ] Implement `Executor<CliConfig, CliDetail>` interface
  - [ ] Implement connect() method (if needed)
  - [ ] Implement disconnect() method (if needed)
  - [ ] Implement loadDetail() method
  - [ ] Implement execute() method
  - [ ] Implement health() method (if needed)
  - [ ] Preserve existing functionality
- [ ] Write unit tests for CLI executor
- [ ] Update CLI executor tests

### Integration
- [ ] Update `src/mcp/server.ts`
  - [ ] Use `ExecutorRegistry` for executor selection
  - [ ] Update `executeApp()` method
  - [ ] Update `loadLayer3Detail()` method
- [ ] Write integration tests for unified executor flow

## Phase 4: Discovery Consolidation (Week 4)

### Discovery Framework
- [ ] Create `src/discovery/interface.ts`
  - [ ] Define `DiscoverySource` interface
- [ ] Create `src/discovery/manager.ts`
  - [ ] Implement `DiscoveryManager` class
  - [ ] Implement register() method
  - [ ] Implement scanAll() method
  - [ ] Implement caching logic
- [ ] Write unit tests for discovery manager

### Discovery Sources
- [ ] Create `src/discovery/sources/desktop.ts`
  - [ ] Implement `DesktopDiscoverySource` class
  - [ ] Migrate existing desktop discovery logic
  - [ ] Implement caching support
  - [ ] Write tests
- [ ] Create `src/discovery/sources/agents.ts`
  - [ ] Implement `AgentDiscoverySource` class
  - [ ] Migrate existing agent discovery logic
  - [ ] Write tests
- [ ] Create `src/discovery/sources/managed.ts`
  - [ ] Implement `ManagedDiscoverySource` class
  - [ ] Migrate existing managed descriptor logic
  - [ ] Implement caching support
  - [ ] Write tests
- [ ] Update `src/discovery/index.ts`
  - [ ] Export discovery manager
  - [ ] Export discovery sources
  - [ ] Maintain backward compatibility

### Integration
- [ ] Update `src/mcp/server.ts`
  - [ ] Use `DiscoveryManager` instead of direct calls
  - [ ] Initialize discovery sources
  - [ ] Update `initialize()` method
- [ ] Write integration tests for unified discovery flow

## Phase 5: Storage Simplification (Week 5)

### Registry Migration
- [ ] Update `src/storage/mcp-registry.ts`
  - [ ] Use `FileRegistry<McpRegistryEntry>` implementation
  - [ ] Preserve existing functionality
  - [ ] Update tests
- [ ] Update `src/storage/skill-registry.ts`
  - [ ] Use `FileRegistry<SkillRegistryEntry>` implementation
  - [ ] Preserve existing functionality
  - [ ] Update tests
- [ ] Create `src/storage/managed-registry.ts`
  - [ ] Implement unified managed descriptor registry
  - [ ] Use `FileRegistry<ManagedEntry>` implementation
  - [ ] Write tests
- [ ] Consolidate cache implementations
  - [ ] Replace `descriptor-cache.ts` with `SimpleCache`
  - [ ] Replace `name-cache.ts` with `SimpleCache`
  - [ ] Update tests

### Storage Refactoring
- [ ] Review and simplify `src/storage/managed-descriptors.ts`
  - [ ] Eliminate redundant code
  - [ ] Use new registry interfaces
  - [ ] Update tests
- [ ] Review `src/storage/paths.ts`
  - [ ] Ensure paths are consistent
  - [ ] Add documentation
- [ ] Update storage index exports
  - [ ] Export new interfaces
  - [ ] Maintain backward compatibility

## Phase 6: Cleanup (Week 6)

### Code Cleanup
- [ ] Remove deprecated code from `src/cli.ts`
- [ ] Remove old executor implementation code
- [ ] Remove old discovery implementation code
- [ ] Remove redundant storage code
- [ ] Update all imports to use new structure
- [ ] Run linter and fix all warnings
- [ ] Run type checker and fix all errors

### Testing
- [ ] Run full test suite
- [ ] Fix any failing tests
- [ ] Add missing test coverage
- [ ] Run integration tests
- [ ] Run E2E tests
- [ ] Performance testing
- [ ] Benchmark before/after

### Documentation
- [ ] Update README with new architecture
- [ ] Update code comments
- [ ] Update API documentation
- [ ] Update migration guide
- [ ] Add contributor guidelines
- [ ] Update CHANGELOG.md

### Release Preparation
- [ ] Update version number
- [ ] Create release notes
- [ ] Verify all changes are committed
- [ ] Create git tag
- [ ] Test release build

## Additional Tasks

### Error Handling
- [ ] Enhance `src/types/errors.ts`
  - [ ] Add new error codes
  - [ ] Add error categories
  - [ ] Add error context types
- [ ] Create `src/utils/error-handler.ts`
  - [ ] Implement `ErrorHandler` class
  - [ ] Add structured logging
  - [ ] Add error wrapping logic
- [ ] Update all error handling to use new patterns
- [ ] Write tests for error handler

### Performance Optimization
- [ ] Profile executor performance
- [ ] Profile discovery performance
- [ ] Profile storage performance
- [ ] Optimize hot paths
- [ ] Add performance benchmarks

### Security Review
- [ ] Review storage security
- [ ] Review executor security
- [ ] Review CLI security
- [ ] Update security documentation
- [ ] Add security tests

## Success Criteria

- [ ] All tests passing with >80% coverage
- [ ] No performance regression
- [ ] No breaking changes to public API
- [ ] Documentation complete and accurate
- [ ] Code review approved
- [ ] Manual testing successful
