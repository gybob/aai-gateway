# AAI Gateway Architecture

## 1. Overall Project Structure

```
aai-gateway/
├── src/
│   ├── index.ts                 # Library entry point (exports)
│   ├── cli.ts                   # CLI entry point
│   ├── core/                    # Core services
│   │   ├── index.ts
│   │   ├── app-registry.ts     # App registry management
│   │   ├── execution-coordinator.ts # Execution routing
│   │   ├── guide-service.ts    # Guide generation
│   │   ├── import-service.ts    # MCP/Skill import logic
│   │   └── background/         # Background tasks
│   │       ├── task-manager.ts
│   │       ├── discovery-task.ts
│   │       ├── acp-prewarm-task.ts
│   │       └── turn-cleanup.ts
│   ├── executors/               # Protocol executors
│   │   ├── interface.ts        # Executor interface
│   │   ├── registry.ts         # Executor registry
│   │   ├── mcp.ts            # MCP executor
│   │   ├── skill.ts           # Skill executor
│   │   ├── acp.ts             # ACP agent executor
│   │   ├── cli.ts             # CLI executor
│   │   ├── events.ts          # Execution events/observers
│   │   └── acp-tool-schemas.ts # ACP tool definitions
│   ├── discovery/               # App discovery
│   │   ├── index.ts
│   │   ├── interface.ts
│   │   ├── manager.ts          # Discovery manager
│   │   ├── checks.ts           # Availability checks
│   │   ├── agent-registry.ts   # Builtin agent scanning
│   │   ├── macos.ts
│   │   ├── linux.ts
│   │   ├── windows.ts
│   │   ├── sources/
│   │   │   ├── index.ts
│   │   │   ├── desktop.ts      # Desktop app discovery
│   │   │   ├── agents.ts       # ACP agent discovery
│   │   │   └── managed.ts     # Managed app discovery
│   │   └── descriptors/         # Builtin agent descriptors
│   │       ├── claude-code-agent.ts
│   │       ├── codex-agent.ts
│   │       └── opencode-agent.ts
│   ├── storage/                 # Storage layer
│   │   ├── index.ts
│   │   ├── interface.ts
│   │   ├── registry.ts          # File-based registry
│   │   ├── mcp-registry.ts    # MCP import registry
│   │   ├── skill-registry.ts  # Skill import registry
│   │   ├── managed-registry.ts # Managed app registry
│   │   ├── cache.ts           # Simple in-memory cache
│   │   ├── descriptor-cache.ts # Descriptor caching
│   │   ├── agent-state.ts     # Agent state storage
│   │   ├── paths.ts           # Path utilities
│   │   └── secure-storage/     # Platform-specific secure storage
│   │       ├── interface.ts
│   │       ├── index.ts
│   │       ├── macos.ts
│   │       ├── linux.ts
│   │       └── windows.ts
│   ├── consent/                 # Consent management
│   │   ├── manager.ts
│   │   └── dialog/
│   │       ├── interface.ts
│   │       ├── index.ts
│   │       ├── macos.ts
│   │       ├── linux.ts
│   │       └── windows.ts
│   ├── guides/                  # Guide generation
│   │   ├── app-guide-generator.ts
│   │   ├── skill-create-guide.ts
│   │   └── skill-stub-generator.ts
│   ├── mcp/                     # MCP server implementation
│   │   ├── server.ts           # Main MCP server
│   │   ├── importer.ts         # MCP/Skill import logic
│   │   ├── search-guidance.ts # Search guidance
│   │   └── task-runner.ts
│   ├── types/                   # Type definitions
│   ├── parsers/
│   │   └── schema.ts           # Schema parsing
│   ├── utils/                   # Utilities
│   ├── cli/                      # CLI framework
│   ├── errors/
│   │   └── errors.ts           # Error types
│   └── version.ts
```

---

## 2. Layer Architecture

### 2.1 Entry Points

#### **Library Entry** (`src/index.ts`)

Library entry point that exports all public APIs.

**Exports:**

- `AaiGatewayServer` and `createGatewayServer()`
- `logger` for logging
- `parseAaiJson()` for schema parsing
- Storage, consent, and discovery functions
- All executor types and registry functions
- CLI framework components

#### **CLI Entry** (`src/cli.ts`)

CLI application entry point.

**Commands:** `serve`, `scan`, `list`, `guide`, `exec`

**Key Functions:**

- `parseArgs()` - Parse command-line arguments
- `runScan()` - Scan for available apps
- `runList()` - List discovered apps
- `runGuide()` - Show guide for app
- `runExec()` - Execute tool

---

### 2.2 Core Layer (`src/core/`)

Core services that provide the main business logic, decoupled from MCP protocol.

#### **AppRegistry** (`core/app-registry.ts`)

Manages the registry of discovered and imported apps.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `set(appId, record)` | Add or update app record |
| `get(appId)` | Get app by ID |
| `has(appId)` | Check if app exists |
| `delete(appId)` | Remove app |
| `getAll()` | List all apps |
| `values()` | Iterable of app records |
| `filter(predicate)` | Filter apps by predicate |
| `getByProtocol(protocol)` | Get apps filtered by protocol |
| `loadFromDiscovery(fn)` | Bulk load from discovery function |

#### **ExecutionCoordinator** (`core/execution-coordinator.ts`)

Routes execution to appropriate executors, handles consent checking and inactivity timeout management.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `checkConsent(appRecord, toolName, caller)` | Verify consent for tool execution |
| `execute(appId, descriptor, toolName, args, observer?)` | Execute tool via correct executor |
| `executeWithInactivityTimeout(appId, descriptor, toolName, args, observer?)` | Execute with 10-minute downstream timeout |
| `getExecutor(protocol)` | Get executor for protocol |

**Routing Logic:**

- `mcp` → `McpExecutor`
- `skill` → `SkillExecutor`
- `acp-agent` → `AcpExecutor`
- `cli` → `CliExecutor`

#### **GuideService** (`core/guide-service.ts`)

Handles generation of guides and tool summaries.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `generateAppGuide(appId, descriptor, capabilities)` | Generate full app guide markdown |
| `generateToolSummary(appId, descriptor)` | Generate one-line tool summary |
| `buildToolListForCaller(apps, gatewayToolDefinitions)` | Build tool list for MCP response |

#### **ImportService** (`core/import-service.ts`)

Handles MCP server and skill import logic.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `importMcp(options, caller)` | Import MCP server with consent policy |
| `importSkill(options, caller)` | Import skill with stub generation |
| `removeApp(appId)` | Remove imported app from all registries |
| `getAppCapabilities(appId, descriptor)` | Load app capabilities from executor |

---

### 2.3 Background Tasks (`src/core/background/`)

Framework for managing background tasks with dependency resolution.

#### **BackgroundTaskManager** (`background/task-manager.ts`)

Manages background tasks with dependency-based execution ordering.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `register(task)` | Register a background task |
| `startAll()` | Start all tasks in dependency order |
| `stopAll()` | Gracefully stop all tasks |
| `schedulePeriodic(taskName, intervalMs, fn)` | Schedule recurring task execution |

**Dependency Resolution:**

- Tasks declare dependencies via `dependencies: string[]`
- Topological sort determines execution order
- Tasks with no dependencies run first

#### **DiscoveryBackgroundTask** (`background/discovery-task.ts`)

Runs discovery at startup.

| Property       | Value             |
| -------------- | ----------------- |
| `name`         | `'discovery'`     |
| `dependencies` | `[]` (runs first) |

**Responsibility:** Scans all discovery sources and populates AppRegistry.

#### **AcpPrewarmBackgroundTask** (`background/acp-prewarm-task.ts`)

Pre-initializes ACP agent processes.

| Property       | Value                        |
| -------------- | ---------------------------- |
| `name`         | `'acp-prewarm'`              |
| `dependencies` | `['discovery']` (runs after) |

**Responsibility:** Connect to all discovered ACP agents to warm up connections.

#### **TurnCleanupTask** (`background/turn-cleanup.ts`)

Cleans up finished prompt turns that haven't been polled.

| Property       | Value            |
| -------------- | ---------------- |
| `name`         | `'turn-cleanup'` |
| `dependencies` | `[]`             |

**Responsibility:** Periodically remove turns older than retention period (7 days).

---

### 2.4 Executors Layer (`src/executors/`)

Protocol executors that handle actual tool execution.

#### **Executor Interface** (`interface.ts`)

All executors implement this interface:

```typescript
interface Executor {
  readonly protocol: string;
  connect(appId: string, config: unknown): Promise<void>;
  disconnect(appId: string): Promise<void>;
  loadAppCapabilities(appId: string, config: unknown): Promise<AppCapabilities>;
  execute(
    appId: string,
    config: unknown,
    operation: string,
    args: Record<string, unknown>
  ): Promise<ExecutionResult>;
  health(appId: string): Promise<boolean>;
}
```

#### **McpExecutor** (`executors/mcp.ts`)

Implements MCP protocol for stdio and HTTP transports.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `connect(appId, config, headers?)` | Connect via StdioClientTransport or HTTP transport |
| `disconnect(appId)` | Close connection and clear tools cache |
| `loadAppCapabilities(appId, config)` | List tools and cache schemas |
| `execute(appId, config, operation, args)` | Call MCP tool with validation |
| `health(appId)` | Check if client exists |
| `listTools(target)` | List available MCP tools |
| `callTool(target, toolName, args, observer?)` | Execute tool with retry logic |
| `close(appId)` | Alias for disconnect |
| `createTransport(config, headers)` | Create appropriate transport |

**Features:**

- Caches tool schemas for validation
- Auto-retries on failure (reconnects once)
- Resolves environment variables from `.env` files
- Supports stdio, streamable-http, and SSE transports

#### **AcpExecutor** (`executors/acp.ts`)

Implements ACP agent protocol with session/turn management.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `connect/disconnect` | Spawn/terminate agent process |
| `loadAppCapabilities()` | Returns ACP tool schemas (session/new, turn/start, etc.) |
| `execute(appId, config, operation, args)` | Route to internal methods |
| `executeWithObserver(...)` | Execute with progress/cancellation support |
| `health()` | Check if initialized |

**ACP Tool Schemas (hardcoded):**

- `session/new` - Create new session
- `turn/start` - Start prompt turn
- `turn/poll` - Poll for results
- `turn/respondPermission` - Respond to permission request
- `turn/cancel` - Cancel turn

**Internal Methods:**

- `ensureInitialized()` - Spawn process and send initialize RPC
- `handleSessionNewRequest()` - Create new session
- `handleTurnStartRequest()` - Start prompt turn
- `handleTurnPollRequest()` - Poll for turn completion
- `handleTurnCancelRequest()` - Cancel running turn
- `handleTurnRespondPermissionRequest()` - Handle permission responses

**Features:**

- JSON-RPC 2.0 over stdio
- Session management with prompt turns
- Permission request handling with timeout
- Turn queuing for same session
- Inactivity timeout (10 minutes)
- Content accumulation with text merging

#### **SkillExecutor** (`executors/skill.ts`)

Implements skill protocol for reading SKILL.md files.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `connect/disconnect` | No-op (stateless) |
| `loadAppCapabilities()` | Returns single "read" tool |
| `execute()` | Only supports "read" operation |
| `health()` | Always returns true |
| `readSkill(config, args)` | Read SKILL.md with optional section parsing |

#### **CliExecutor** (`executors/cli.ts`)

Implements CLI protocol for command-line tools.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `connect/disconnect` | No-op |
| `loadAppCapabilities()` | Parse --help output for commands |
| `execute()` | Spawn process with args |
| `health()` | Always true |
| `executeCli()` | Run CLI with arguments |

#### **ExecutorRegistry** (`executors/registry.ts`)

Central registry for all executor implementations.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `register(protocol, executor)` | Register executor |
| `get(protocol)` | Get executor by protocol |
| `has(protocol)` | Check if registered |
| `execute(protocol, appId, config, operation, args)` | Execute via appropriate executor |
| `connect/disconnect/health` | Delegate to executor |

**Built-in Executors:**
| Protocol | Executor |
|----------|----------|
| `'mcp'` | McpExecutor |
| `'skill'` | SkillExecutor |
| `'acp-agent'` | AcpExecutor |
| `'cli'` | CliExecutor |

---

### 2.5 Discovery Layer (`src/discovery/`)

System for discovering available apps from various sources.

#### **DiscoveryManager** (`discovery/manager.ts`)

Manages multiple discovery sources with caching.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `register(source)` | Add discovery source (sorted by priority) |
| `unregister(name)` | Remove discovery source |
| `scanAll(options?)` | Scan all sources, combine results |
| `scanSource(source, options?)` | Scan specific source (with 5-min caching) |
| `refreshAll()` | Force refresh all sources |
| `clearCache()/clearSourceCache(name)` | Cache management |

**Features:**

- Priority-based source ordering (higher = runs first)
- 5-minute cache TTL per source
- Error isolation per source (one failure doesn't break others)

#### **Discovery Sources**

| Source                   | Priority | Description                           |
| ------------------------ | -------- | ------------------------------------- |
| `DesktopDiscoverySource` | 100      | Platform-specific desktop directories |
| `AgentDiscoverySource`   | 90       | Built-in agent descriptors            |
| `ManagedDiscoverySource` | 80       | Managed app directories               |

#### **Discovery Checks** (`discovery/checks.ts`)

Evaluates descriptor availability.

**Key Functions:**
| Function | Description |
|----------|-------------|
| `evaluateDescriptorAvailability(descriptor)` | Run discovery checks |
| `resolveCommandPath(command)` | Find command in PATH |
| `resolveFilePath(path)` | Check file exists |
| `resolveDirectoryPath(path)` | Check directory exists |

#### **Agent Descriptors** (`discovery/descriptors/`)

Built-in agent definitions for ACP-based agents.

| Descriptor             | App ID         | Description         |
| ---------------------- | -------------- | ------------------- |
| `claude-code-agent.ts` | `acp-claude`   | Claude Code via npx |
| `codex-agent.ts`       | `acp-codex`    | Codex agent         |
| `opencode-agent.ts`    | `acp-opencode` | OpenCode agent      |

---

### 2.6 Storage Layer (`src/storage/`)

Persistent storage for various data types.

#### **FileRegistry<T>** (`storage/registry.ts`)

Generic JSON file-based registry.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `list()` | List all items |
| `get(id)` | Get item by ID |
| `upsert(item)` | Add or update item |
| `delete(id)` | Remove item |

#### **McpRegistry** (`storage/mcp-registry.ts`)

Manages imported MCP server registrations.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `list()` | List all MCP entries |
| `get(id)` | Get entry by appId |
| `upsert(entry, descriptor)` | Add/update with descriptor file |
| `delete(id)` | Remove entry |
| `loadApps()` | Load apps with parsed descriptors |

#### **SkillRegistry** (`storage/skill-registry.ts`)

Manages imported skill registrations. Same interface as `McpRegistry`.

#### **SimpleCache<T>** (`storage/cache.ts`)

In-memory cache with TTL support.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `get(key)` | Get value (null if expired/missing) |
| `set(key, value, ttl?)` | Set with optional TTL (default 5 min) |
| `has(key)` | Check exists (unexpired) |
| `delete(key)` | Remove |
| `clear()` | Clear all |
| `cleanup()` | Remove expired entries |

#### **SecureStorage** (`storage/secure-storage/`)

Platform-specific secure credential storage.

**Interface:**

```typescript
interface SecureStorage {
  get(account: string): Promise<string | null>;
  set(account: string, value: string): Promise<void>;
  delete(account: string): Promise<void>;
}
```

**Implementations:**
| Platform | Implementation |
|----------|----------------|
| macOS | Keychain Services |
| Linux | libsecret (fallback to encrypted file) |
| Windows | Windows Credential Manager |

#### **Agent State** (`storage/agent-state.ts`)

Per-agent state management.

**Key Functions:**
| Function | Description |
|----------|-------------|
| `loadAgentState/saveAgentState` | Agent state CRUD |
| `upsertAgentState` | Create or update |
| `disableAppForAgent/enableAppForAgent` | Toggle app for specific agent |
| `loadAppPolicyState/saveAppPolicyState` | App-wide policy |
| `removeAppFromAllAgents` | Clean up when app removed |

---

### 2.7 Consent Layer (`src/consent/`)

Manages per-agent, per-app consent for tool execution.

#### **ConsentManager** (`consent/manager.ts`)

Manages consent records.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `isGranted(appId, toolName, callerName)` | Check if consent exists |
| `checkAndPrompt(appId, appName, toolInfo, callerIdentity)` | Check and show dialog if needed |

**Consent Flow:**

1. Load existing record for caller+app
2. If `all_tools` granted, allow
3. If tool remembered (granted or denied), use that
4. Otherwise, show dialog
5. Save decision (grant/deny, remember option)

#### **Consent Dialog** (`consent/dialog/`)

Platform-specific consent dialog implementations.

**Interface:**

```typescript
interface ConsentDialog {
  show(info: ConsentDialogInfo): Promise<ConsentDialogResult>;
}

interface ConsentDialogInfo {
  callerName: string;
  appId: string;
  appName: string;
  toolName: string;
  toolDescription: string;
  parameters: object;
}

interface ConsentDialogResult {
  decision: 'tool' | 'all' | 'deny';
  remember: boolean;
}
```

---

### 2.8 MCP Server Layer (`src/mcp/`)

Main MCP server implementation.

#### **AaiGatewayServer** (`mcp/server.ts`)

Main MCP server using @modelcontextprotocol/sdk.

**Properties:**
| Property | Type | Description |
|----------|------|-------------|
| `server` | `Server` | MCP SDK Server instance |
| `appRegistry` | `AppRegistry` | Discovered/imported apps |
| `consentManager` | `ConsentManager` | Consent management |
| `secureStorage` | `SecureStorage` | Credential storage |
| `discoveryManager` | `DiscoveryManager` | App discovery |
| `backgroundTasks` | `BackgroundTaskManager` | Background task framework |
| `executionCoordinator` | `ExecutionCoordinator` | Execution routing |
| `guideService` | `GuideService` | Guide generation |
| `importService` | `ImportService` | Import logic |

**Key Methods:**
| Method | Description |
|--------|-------------|
| `initialize()` | Set up all services and start background tasks |
| `start()` | Connect stdio transport and start server |
| `listToolsForCaller(caller)` | List available tools |
| `getAppGuideForCaller(appId, caller)` | Get guide for app |
| `executeForCaller(appId, toolName, args, caller)` | Execute tool |

**Gateway Tools:**
| Tool | Handler | Description |
|------|---------|-------------|
| `aai:exec` | `handleExec()` | Execute any tool |
| `mcp:import` | `handleMcpImport()` | Import MCP server (2-phase) |
| `skill:import` | `handleSkillImport()` | Import skill |
| `skill:create` | `handleSkillCreate()` | Skill creation guide |
| `search:discover` | `handleSearchDiscover()` | Search for MCP/skill |
| `listAllAaiApps` | `handleListAllApps()` | List all apps |
| `disableApp` | `handleDisableApp()` | Disable app for caller |
| `enableApp` | `handleEnableApp()` | Enable app for caller |
| `removeApp` | `handleRemoveApp()` | Remove imported app |

---

## 3. Key Data Flows

### Tool Execution Flow

```
1. MCP request arrives at AaiGatewayServer
2. setRequestHandler(CallToolRequestSchema) processes request
3. If app:<id>, return app guide
4. If aai:exec, call handleExec()
5. handleExec() resolves app via resolveApp()
6. Consent checked via consentManager.checkAndPrompt()
7. executionCoordinator.executeWithInactivityTimeout() routes to executor
8. Executor executes and returns ExecutionResult
9. Result converted to CallToolResult and returned
```

### Import Flow (MCP)

```
1. Agent calls mcp:import without summary (inspection phase)
2. handleMcpImport() calls discoverMcpImport() to list tools
3. Returns tool list for agent to review
4. Agent presents to user, collects summary and enableScope
5. Agent calls mcp:import with metadata (import phase)
6. importService.importMcp() saves descriptor and policy
7. App added to AppRegistry
8. notifyToolsListChanged() triggers hot-reload
```

### Discovery Flow

```
1. AaiGatewayServer.initialize() starts
2. BackgroundTaskManager.startAll() begins
3. DiscoveryBackgroundTask scans all sources
4. Each app added to AppRegistry
5. AcpPrewarmBackgroundTask warms ACP connections
6. TurnCleanupTask schedules periodic cleanup
```

---

## 4. Key Design Patterns

| Pattern                 | Usage                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------- |
| **Singleton Executors** | `getMcpExecutor()`, `getSkillExecutor()` return cached instances                       |
| **Registry**            | `ExecutorRegistry`, `McpRegistry`, `SkillRegistry` manage registrations                |
| **Strategy**            | Discovery sources can be swapped                                                       |
| **Observer**            | `ExecutionObserver` for progress/cancellation                                          |
| **Factory**             | `createSecureStorage()`, `createConsentDialog()` for platform-specific implementations |
| **Background Tasks**    | Dependency-based startup with `BackgroundTaskManager`                                  |
| **2-Phase Operations**  | MCP import (inspect then finalize), consent (check then prompt)                        |

---

## 5. Type System

### Core Types (`src/types/aai-json.ts`)

```typescript
// Access configurations
type McpConfig = McpStdioConfig | McpRemoteConfig;
type SkillConfig = SkillPathConfig | SkillUrlConfig;
type Access = McpAccess | SkillAccess | AcpAgentAccess | CliAccess;

// AAI JSON descriptor
interface AaiJson {
  schemaVersion: '2.0';
  version: string;
  app: { name: InternationalizedName; iconUrl?: string };
  discovery?: DiscoveryRule;
  access: Access;
  exposure: { summary: string; keywords?: string[] };
}

// Runtime app record
interface RuntimeAppRecord {
  appId: string;
  descriptor: AaiJson;
  source: 'desktop' | 'web' | 'mcp-import' | 'skill-import' | 'acp-agent' | 'cli';
  location?: string;
  toolSchemas?: Record<string, Record<string, unknown>>;
}
```

### Capability Types (`src/types/capabilities.ts`)

```typescript
interface ToolSchema {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

interface AppCapabilities {
  title: string;
  tools: ToolSchema[];
}
```

### Execution Types (`src/types/executor.ts`)

```typescript
interface ExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}
```

---

## 6. Constants

### Discovery Source Priorities

| Source                 | Priority |
| ---------------------- | -------- |
| DesktopDiscoverySource | 100      |
| AgentDiscoverySource   | 90       |
| ManagedDiscoverySource | 80       |

### Cache TTLs

| Cache               | TTL               |
| ------------------- | ----------------- |
| Discovery scan      | 5 minutes         |
| Descriptor (remote) | 24 hours          |
| Agent state         | None (persistent) |

### Timeouts

| Timeout               | Duration   |
| --------------------- | ---------- |
| Downstream inactivity | 10 minutes |
| Turn poll wait        | 30 seconds |
| Permission request    | 5 minutes  |
| Turn transition delay | 2 seconds  |

### Turn Retention

| Retention             | Duration |
| --------------------- | -------- |
| Finished turn cleanup | 7 days   |
