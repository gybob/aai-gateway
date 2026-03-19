# Design: Refactor and Simplify AAI Gateway Architecture

## Overview

This design outlines the architectural refactoring needed to simplify the AAI Gateway codebase while maintaining all existing functionality.

## 1. CLI Architecture Refactoring

### Current Problems
- `src/cli.ts` is 400+ lines with repetitive argument parsing
- Each command has its own parsing logic with significant code duplication
- Hard to test individual commands
- Difficult to add new commands

### Proposed Solution

#### 1.1 Command Interface
```typescript
// src/cli/commands/interface.ts
export interface Command {
  name: string;
  description: string;
  parse(args: string[]): CommandOptions;
  execute(options: CommandOptions): Promise<void>;
}

export interface CommandOptions {
  dev: boolean;
  [key: string]: unknown;
}
```

#### 1.2 Argument Parser Framework
```typescript
// src/cli/parser.ts
export class ArgumentParser {
  private definitions: Map<string, ArgumentDef> = new Map();

  define(def: ArgumentDef): void {
    this.definitions.set(def.name, def);
  }

  parse(args: string[]): Record<string, unknown> {
    // Unified parsing logic
    // Handles flags, key-value pairs, positional args
  }
}

export interface ArgumentDef {
  name: string;
  type: 'flag' | 'string' | 'array' | 'object';
  required?: boolean;
  default?: unknown;
  description?: string;
}
```

#### 1.3 Command Modules
```
src/cli/commands/
├── index.ts           # Command registry
├── serve.ts
├── scan.ts
├── mcp-import.ts
├── mcp-refresh.ts
└── skill-import.ts
```

#### 1.4 New CLI Structure
```typescript
// src/cli/index.ts
import { registerCommands } from './commands/index.js';
import { ArgumentParser } from './parser.js';

async function main() {
  const parser = new ArgumentParser();
  const commands = registerCommands(parser);

  // Parse and execute
  const result = parser.parse(process.argv.slice(2));
  const command = commands.get(result.command);

  if (command) {
    await command.execute(result);
  }
}
```

### Benefits
- Reduced code duplication
- Easier to test individual commands
- Simpler to add new commands
- Better separation of concerns

## 2. Unified Executor Interface

### Current Problems
- Executors have different interfaces and return types
- No common abstraction for connection management
- Inconsistent error handling
- Difficult to add new executor types

### Proposed Solution

#### 2.1 Executor Interface
```typescript
// src/executors/interface.ts
export interface Executor<TConfig, TDetail> {
  readonly protocol: string;

  // Connection lifecycle
  connect(localId: string, config: TConfig): Promise<void>;
  disconnect(localId: string): Promise<void>;

  // Capability discovery
  loadDetail(config: TConfig): Promise<TDetail>;

  // Execution
  execute(
    localId: string,
    config: TConfig,
    operation: string,
    args: Record<string, unknown>
  ): Promise<ExecutionResult>;

  // Health check
  health(localId: string): Promise<boolean>;
}

export interface ExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}
```

#### 2.2 Executor Registry
```typescript
// src/executors/registry.ts
export class ExecutorRegistry {
  private executors = new Map<string, Executor<unknown, unknown>>();

  register<TConfig, TDetail>(
    protocol: string,
    executor: Executor<TConfig, TDetail>
  ): void {
    this.executors.set(protocol, executor);
  }

  get(protocol: string): Executor<unknown, unknown> | undefined {
    return this.executors.get(protocol);
  }

  async execute(
    protocol: string,
    localId: string,
    config: unknown,
    operation: string,
    args: Record<string, unknown>
  ): Promise<ExecutionResult> {
    const executor = this.get(protocol);
    if (!executor) {
      throw new Error(`Unknown protocol: ${protocol}`);
    }
    return executor.execute(localId, config, operation, args);
  }
}
```

#### 2.3 Updated Executor Implementations

Each executor implements the unified interface:

```typescript
// src/executors/mcp.ts (simplified)
export class McpExecutor implements Executor<McpConfig, McpDetail> {
  readonly protocol = 'mcp';

  private clients = new Map<string, Client>();

  async connect(localId: string, config: McpConfig): Promise<void> {
    // Connection logic
  }

  async disconnect(localId: string): Promise<void> {
    // Cleanup
  }

  async loadDetail(config: McpConfig): Promise<McpDetail> {
    // Load MCP tools
  }

  async execute(
    localId: string,
    config: McpConfig,
    operation: string,
    args: Record<string, unknown>
  ): Promise<ExecutionResult> {
    // Execute MCP tool
  }

  async health(localId: string): Promise<boolean> {
    // Health check
  }
}
```

### Benefits
- Consistent interface across all executors
- Simplified executor management
- Easier to add new protocols
- Better testability

## 3. Consolidated Discovery Mechanism

### Current Problems
- Platform-specific discovery code has redundant patterns
- Agent registry overlaps with general app discovery
- Inconsistent error handling across discovery sources

### Proposed Solution

#### 3.1 Discovery Source Interface
```typescript
// src/discovery/interface.ts
export interface DiscoverySource {
  readonly name: string;
  readonly priority: number;

  scan(options?: DiscoveryOptions): Promise<RuntimeAppRecord[]>;

  // Optional caching
  shouldCache(): boolean;
  getCacheKey(): string;
}
```

#### 3.2 Discovery Manager
```typescript
// src/discovery/manager.ts
export class DiscoveryManager {
  private sources: DiscoverySource[] = [];
  private cache: Map<string, RuntimeAppRecord[]> = new Map();

  register(source: DiscoverySource): void {
    this.sources.push(source);
    this.sources.sort((a, b) => b.priority - a.priority);
  }

  async scanAll(options?: DiscoveryOptions): Promise<RuntimeAppRecord[]> {
    const results: RuntimeAppRecord[] = [];

    for (const source of this.sources) {
      try {
        const apps = await this.scanSource(source, options);
        results.push(...apps);
      } catch (err) {
        logger.error({ err, source: source.name }, 'Discovery source failed');
      }
    }

    return results;
  }

  private async scanSource(
    source: DiscoverySource,
    options?: DiscoveryOptions
  ): Promise<RuntimeAppRecord[]> {
    if (source.shouldCache()) {
      const cached = this.cache.get(source.getCacheKey());
      if (cached) return cached;
    }

    const apps = await source.scan(options);

    if (source.shouldCache()) {
      this.cache.set(source.getCacheKey(), apps);
    }

    return apps;
  }
}
```

#### 3.3 Platform-Specific Implementations
```typescript
// src/discovery/sources/desktop.ts
export class DesktopDiscoverySource implements DiscoverySource {
  readonly name = 'desktop';
  readonly priority = 10;

  shouldCache(): boolean {
    return true;
  }

  getCacheKey(): string {
    return 'desktop:apps';
  }

  async scan(options?: DiscoveryOptions): Promise<RuntimeAppRecord[]> {
    // Existing desktop discovery logic
  }
}

// src/discovery/sources/agents.ts
export class AgentDiscoverySource implements DiscoverySource {
  readonly name = 'agents';
  readonly priority = 5;

  shouldCache(): boolean {
    return false;
  }

  getCacheKey(): string {
    return 'agents:list';
  }

  async scan(options?: DiscoveryOptions): Promise<RuntimeAppRecord[]> {
    // Existing agent discovery logic
  }
}

// src/discovery/sources/managed.ts
export class ManagedDiscoverySource implements DiscoverySource {
  readonly name = 'managed';
  readonly priority = 1;

  shouldCache(): boolean {
    return true;
  }

  getCacheKey(): string {
    return 'managed:descriptors';
  }

  async scan(options?: DiscoveryOptions): Promise<RuntimeAppRecord[]> {
    // Existing managed descriptors logic
  }
}
```

### Benefits
- Eliminates code duplication
- Consistent error handling
- Easy to add new discovery sources
- Built-in caching support
- Priority-based execution

## 4. Storage Layer Simplification

### Current Problems
- Multiple registry files (mcp-registry, skill-registry) with overlapping structure
- `descriptor-cache.ts` and `name-cache.ts` have unclear responsibilities
- Inconsistent storage patterns

### Proposed Solution

#### 4.1 Unified Registry Interface
```typescript
// src/storage/interface.ts
export interface Registry<T> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | null>;
  upsert(item: T): Promise<T>;
  delete(id: string): Promise<boolean>;
}

export interface RegistryItem {
  id: string;
  updatedAt: string;
}
```

#### 4.2 Generic Registry Implementation
```typescript
// src/storage/registry.ts
export class FileRegistry<T extends RegistryItem> implements Registry<T> {
  constructor(
    private filePath: string,
    private serializer: (item: T) => string,
    private deserializer: (raw: string) => T
  ) {}

  async list(): Promise<T[]> {
    // Load and parse registry file
  }

  async get(id: string): Promise<T | null> {
    // Find item by id
  }

  async upsert(item: T): Promise<T> {
    // Add or update item
  }

  async delete(id: string): Promise<boolean> {
    // Remove item
  }
}
```

#### 4.3 Simplified Storage Structure
```
src/storage/
├── interface.ts       # Registry interfaces
├── registry.ts        # Generic registry implementation
├── mcp-registry.ts    # MCP-specific registry (using generic impl)
├── skill-registry.ts  # Skill-specific registry (using generic impl)
└── managed-registry.ts # Unified managed descriptor registry
```

#### 4.4 Consolidated Cache
```typescript
// src/storage/cache.ts
export interface CacheEntry<T> {
  key: string;
  value: T;
  expiresAt: number;
}

export class SimpleCache<T> {
  constructor(private ttl: number) {}

  get(key: string): T | null {
    // Get from cache
  }

  set(key: string, value: T): void {
    // Set with expiration
  }

  clear(): void {
    // Clear all entries
  }
}
```

### Benefits
- Reduced code duplication
- Consistent storage patterns
- Easier to test
- Clear separation of concerns

## 5. Type Definition Consolidation

### Current Problems
- Type definitions scattered across multiple files
- Some types defined in implementation files
- Difficult to find all related types

### Proposed Solution

#### 5.1 Centralized Type Structure
```
src/types/
├── index.ts           # Export all types
├── aai-json.ts        # AAI descriptor types (keep)
├── executor.ts        # Executor-related types
├── discovery.ts       # Discovery-related types
├── storage.ts         # Storage-related types
├── cli.ts             # CLI-related types
└── errors.ts          # Error types (keep)
```

#### 5.2 Type Exports
```typescript
// src/types/index.ts
export * from './aai-json.js';
export * from './executor.js';
export * from './discovery.js';
export * from './storage.js';
export * from './cli.js';
export * from './errors.js';
```

### Benefits
- Easier to find types
- Clear module boundaries
- Better IDE support

## 6. Consistent Error Handling

### Current Problems
- Inconsistent error types across components
- Error handling logic scattered
- Difficult to debug

### Proposed Solution

#### 6.1 Error Hierarchy
```typescript
// src/types/errors.ts (enhanced)
export enum ErrorCode {
  // Existing errors
  INVALID_REQUEST = 'INVALID_REQUEST',
  UNKNOWN_APP = 'UNKNOWN_APP',
  UNKNOWN_TOOL = 'UNKNOWN_TOOL',
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',

  // New executor errors
  EXECUTOR_NOT_FOUND = 'EXECUTOR_NOT_FOUND',
  EXECUTOR_CONNECT_FAILED = 'EXECUTOR_CONNECT_FAILED',
  EXECUTOR_EXECUTE_FAILED = 'EXECUTOR_EXECUTE_FAILED',

  // New discovery errors
  DISCOVERY_SOURCE_FAILED = 'DISCOVERY_SOURCE_FAILED',
  DISCOVERY_CACHE_INVALID = 'DISCOVERY_CACHE_INVALID',

  // New storage errors
  STORAGE_READ_FAILED = 'STORAGE_READ_FAILED',
  STORAGE_WRITE_FAILED = 'STORAGE_WRITE_FAILED',
}

export class AaiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public cause?: unknown
  ) {
    super(message);
    this.name = 'AaiError';
  }
}
```

#### 6.2 Error Handler
```typescript
// src/utils/error-handler.ts
export class ErrorHandler {
  static handle(error: unknown): never {
    if (error instanceof AaiError) {
      // Log structured error
      logger.error(
        { code: error.code, message: error.message, cause: error.cause },
        'AAI Error'
      );
      throw error;
    }

    // Wrap unknown errors
    const wrapped = new AaiError(
      ErrorCode.UNKNOWN_ERROR,
      'Unexpected error occurred',
      error
    );
    logger.fatal({ error }, 'Unexpected error');
    throw wrapped;
  }
}
```

### Benefits
- Consistent error types
- Better error messages
- Easier debugging
- Structured logging

## Migration Strategy

### Phase 1: Foundation (Week 1)
1. Create new type definitions
2. Implement unified executor interface
3. Implement generic registry implementation
4. Write tests for new components

### Phase 2: CLI Refactoring (Week 2)
1. Create command interface and parser
2. Migrate serve command
3. Migrate scan command
4. Update tests

### Phase 3: Executor Migration (Week 3)
1. Migrate MCP executor
2. Migrate skill executor
3. Migrate ACP executor
4. Migrate CLI executor
5. Update integration tests

### Phase 4: Discovery Consolidation (Week 4)
1. Create discovery source interface
2. Implement discovery manager
3. Migrate desktop discovery
4. Migrate agent discovery
5. Migrate managed discovery
6. Update tests

### Phase 5: Storage Simplification (Week 5)
1. Create registry interface
2. Migrate MCP registry
3. Migrate skill registry
4. Consolidate caches
5. Update tests

### Phase 6: Cleanup (Week 6)
1. Remove old code
2. Update documentation
3. Final testing
4. Release

## Testing Strategy

1. **Unit Tests**: Test each new component in isolation
2. **Integration Tests**: Test component interactions
3. **E2E Tests**: Verify full workflows
4. **Migration Tests**: Ensure backward compatibility during transition

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking changes | High | Clear migration path, deprecation warnings |
| Test coverage gaps | Medium | Comprehensive testing before merge |
| Performance regression | Low | Benchmarking before/after |
| Documentation outdated | Medium | Update docs with code changes |
