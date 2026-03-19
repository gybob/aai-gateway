# Refactor and Simplify AAI Gateway Architecture

## Overview

This OpenSpec proposal provides a comprehensive plan to refactor and simplify the AAI Gateway codebase, addressing accumulated complexity and redundancy from rapid development.

## Problem Statement

The AAI Gateway codebase has evolved quickly and now contains several architectural issues:

1. **CLI Complexity**: `src/cli.ts` is over 400 lines with repetitive argument parsing
2. **Inconsistent Executors**: No unified interface across executor implementations
3. **Redundant Discovery**: Duplicate code across platform-specific discovery mechanisms
4. **Storage Overhead**: Multiple registry files with overlapping responsibilities
5. **Scattered Types**: Type definitions spread across multiple files
6. **Inconsistent Errors**: No standardized error handling patterns

## Solution Summary

### 1. Modular CLI Architecture
- Refactor CLI into modular command handlers
- Implement unified argument parsing framework
- Each command is independently testable
- Eliminate code duplication

### 2. Unified Executor Interface
- Define common `Executor<TConfig, TDetail>` interface
- All executors implement consistent methods:
  - `connect()` - Connection lifecycle
  - `disconnect()` - Cleanup
  - `loadDetail()` - Capability discovery
  - `execute()` - Operation execution
  - `health()` - Health checks
- Centralized `ExecutorRegistry` for management

### 3. Consolidated Discovery
- Define `DiscoverySource` interface for all app sources
- Centralized `DiscoveryManager` for coordination
- Built-in caching support
- Priority-based execution
- Graceful error handling

### 4. Simplified Storage
- Generic `Registry<T>` interface
- `FileRegistry<T>` implementation reduces duplication
- Unified cache implementation
- Clear separation of concerns

### 5. Centralized Types
- Organize types by domain:
  - `executor.ts` - Executor types
  - `discovery.ts` - Discovery types
  - `storage.ts` - Storage types
  - `cli.ts` - CLI types
- Single export point from `types/index.ts`

### 6. Consistent Error Handling
- Extended error code hierarchy
- Structured error logging
- Centralized error handler
- Better debugging support

## Migration Strategy

The refactoring is organized into 6 phases over 6 weeks:

### Phase 1: Foundation (Week 1)
- Create new type definitions
- Implement unified executor interface
- Implement generic registry
- Write foundational tests

### Phase 2: CLI Refactoring (Week 2)
- Create command interface and parser
- Migrate serve and scan commands
- Update CLI tests

### Phase 3: Executor Migration (Week 3)
- Migrate all executors to new interface
- Update executor tests
- Integrate with executor registry

### Phase 4: Discovery Consolidation (Week 4)
- Implement discovery manager
- Migrate discovery sources
- Update discovery tests

### Phase 5: Storage Simplification (Week 5)
- Implement generic registry
- Migrate storage implementations
- Consolidate caches

### Phase 6: Cleanup (Week 6)
- Remove deprecated code
- Update documentation
- Final testing and release

## Benefits

- **Reduced Complexity**: Cleaner, more maintainable code
- **Better Testing**: Modular components are easier to test
- **Consistency**: Uniform patterns across the codebase
- **Extensibility**: Easier to add new features
- **Performance**: Optimized with caching and lazy loading
- **Developer Experience**: Better IDE support and documentation

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking changes | High | Clear migration path, deprecation warnings |
| Test coverage gaps | Medium | Comprehensive testing before merge |
| Performance regression | Low | Benchmarking before/after |
| Documentation outdated | Medium | Update docs with code changes |

## Files Created

### Core Documents
- `proposal.md` - High-level proposal and rationale
- `design.md` - Detailed technical design
- `tasks.md` - Comprehensive task list with checkboxes
- `README.md` - This summary document

### Specifications
- `specs/unified-executor-interface/spec.md` - Executor interface requirements
- `specs/modular-cli-architecture/spec.md` - CLI architecture requirements
- `specs/consolidated-discovery/spec.md` - Discovery consolidation requirements

## Next Steps

1. **Review**: Review this proposal with the team
2. **Approval**: Get approval to proceed with the refactoring
3. **Phase 1**: Begin with Foundation tasks
4. **Iterate**: Complete phases sequentially
5. **Test**: Comprehensive testing at each phase
6. **Release**: Final cleanup and release

## Success Criteria

- All tests passing with >80% coverage
- No performance regression
- No breaking changes to public API
- Documentation complete and accurate
- Code review approved
- Manual testing successful

---

**Status**: Archived
**Created**: 2026-03-19
**Archived**: 2026-03-19
**Schema**: spec-driven
