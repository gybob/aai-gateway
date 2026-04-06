# AAI Gateway Architecture

## 1. Project Structure

```
aai-gateway/
├── src/
│   ├── index.ts                 # Library entry point (exports)
│   ├── cli.ts                   # CLI entry point (--version, --help, start server)
│   ├── core/                    # Core business logic
│   │   ├── index.ts
│   │   ├── gateway.ts          # Main Gateway class (all business logic)
│   │   ├── seed.ts             # Seeds pre-built ACP agent descriptors on startup
│   │   ├── tool-definitions.ts # Gateway tool schemas & guide generation
│   │   ├── importer.ts         # MCP/Skill import helpers, validation, env substitution
│   │   ├── parsers.ts          # Argument parsing & log summarization
│   │   ├── search-guidance.ts  # Search guidance content for discover tool
│   │   ├── app-registry.ts     # In-memory app registry
│   │   ├── execution-coordinator.ts # Execution routing
│   │   ├── guide-service.ts    # Guide generation
│   │   ├── import-service.ts   # MCP/Skill import orchestration
│   │   └── background/         # Background tasks
│   │       ├── task-manager.ts
│   │       ├── acp-prewarm-task.ts
│   │       └── turn-cleanup.ts
│   ├── executors/               # Protocol executors
│   │   ├── interface.ts        # Executor interface
│   │   ├── mcp.ts              # MCP executor (stdio, HTTP, SSE)
│   │   ├── skill.ts            # Skill executor (SKILL.md reader)
│   │   ├── acp.ts              # ACP agent executor (JSON-RPC over stdio)
│   │   ├── events.ts           # Execution events/observers
│   │   └── acp-tool-schemas.ts # ACP tool definitions
│   ├── discovery/               # Descriptor checks & pre-built agents
│   │   ├── index.ts            # Re-exports evaluateDescriptorAvailability
│   │   ├── checks.ts           # Availability checks (command, file, dir)
│   │   └── descriptors/        # Pre-built ACP agent descriptors
│   │       ├── claude-code-agent.ts
│   │       ├── codex-agent.ts
│   │       └── opencode-agent.ts
│   ├── storage/                 # Persistent storage
│   │   ├── index.ts
│   │   ├── registry.ts         # Generic file-based registry
│   │   ├── mcp-registry.ts     # MCP import registry
│   │   ├── skill-registry.ts   # Skill import registry
│   │   ├── managed-registry.ts # Managed app registry (scans aai.json files)
│   │   ├── cache.ts            # In-memory cache with TTL
│   │   ├── agent-state.ts      # Per-agent state & app policy
│   │   └── paths.ts            # Path utilities
│   ├── guides/                  # Guide generation
│   │   └── app-guide-generator.ts
│   ├── mcp/                     # MCP protocol layer
│   │   └── server.ts           # Thin MCP server (protocol only)
│   ├── types/                   # Type definitions
│   │   ├── index.ts
│   │   ├── aai-json.ts         # Core AaiJson interface
│   │   ├── executor.ts         # Executor types
│   │   ├── storage.ts          # Storage types
│   │   └── caller.ts           # CallerContext type
│   ├── parsers/
│   │   └── schema.ts           # Zod schema validation
│   ├── utils/                   # Utilities
│   ├── errors/
│   │   └── errors.ts           # AaiError class
│   └── version.ts
```

---

## 2. Layer Architecture

### 2.1 Entry Points

#### **CLI Entry** (`src/cli.ts`)

Minimal CLI — supports `--version`, `--help`, and starting the MCP server.

#### **Library Entry** (`src/index.ts`)

Exports public APIs: `Gateway`, `createGatewayServer()`, `seedPrebuiltDescriptors()`, executors, storage, and parsing utilities.

---

### 2.2 MCP Server Layer (`src/mcp/server.ts`)

Thin protocol layer (~170 lines). Handles only MCP protocol concerns:

- Creates `Gateway` instance and delegates all business logic
- `setupHandlers()` maps MCP requests to Gateway methods
- `toCallToolResult()` converts `GatewayTextResult` to MCP `CallToolResult`
- `notifyToolsListChanged()` for hot-reload after imports

**Does NOT contain**: business logic, tool definitions, argument parsing, or app resolution.

---

### 2.3 Core Gateway Layer (`src/core/gateway.ts`)

Central business logic (~450 lines). Protocol-agnostic — returns `GatewayTextResult` objects.

**Key Methods:**
| Method | Description |
|--------|-------------|
| `initialize()` | Seed pre-built descriptors, scan managed apps, start background tasks |
| `createCallerContext()` | Build CallerContext from MCP client info |
| `listTools()` | Build tool list with progressive disclosure |
| `handleAppGuide()` | Return full app guide with tool schemas |
| `handleExec()` | Execute tool via ExecutionCoordinator |
| `handleMcpImport()` | 2-phase MCP import (inspect → finalize) |
| `handleSkillImport()` | Skill import |
| `handleSearchDiscover()` | Search for MCP/skill |
| `handleListAllApps()` | List all apps with status |
| `handleEnableApp()` | Enable app for caller |
| `handleDisableApp()` | Disable app for caller |
| `handleRemoveApp()` | Remove app globally |

**App Resolution:**
- `resolveManagedApp()` — find app in registry
- `resolveManageableApp()` — find manageable (non-seeded) app
- `resolveApp()` — general app lookup

**Visibility:**
- `listVisibleApps()` — apps enabled for the current caller
- `listManageableApps()` — all apps including disabled
- `isAppEnabledForCaller()` — check per-agent policy

---

### 2.4 Tool Definitions (`src/core/tool-definitions.ts`)

Gateway tool schema definitions, extracted from the old server.ts.

**Key Functions:**
| Function | Description |
|----------|-------------|
| `buildGatewayToolDefinitions()` | All gateway tool schemas |
| `getGatewayToolDefinition()` | Get specific tool schema |
| `isGatewayExecutionTool()` | Check if tool is execution tool |
| `generateGatewayToolGuide()` | Generate guide for gateway tool |
| `generateMcpImportGuide()` | Generate MCP import guide |

**Gateway Tools:**
| Tool | Description |
|------|-------------|
| `aai:exec` | Execute any tool |
| `mcp:import` | Import MCP server (2-phase) |
| `skill:import` | Import skill |
| `skill:create` | Create a new skill |
| `search:discover` | Search for MCP/skill |
| `listAllAaiApps` | List all apps |
| `disableApp` | Disable app for caller |
| `enableApp` | Enable app for caller |
| `removeApp` | Remove imported app |

---

### 2.5 Seed Mechanism (`src/core/seed.ts`)

Seeds pre-built ACP agent descriptors on every startup.

- Loads descriptors from `src/discovery/descriptors/*-agent.ts`
- Writes them as `aai.json` to `~/.local/share/aai-gateway/apps/<appId>/`
- Always overwrites to ensure code is the source of truth

---

### 2.6 Execution Layer

#### **ExecutionCoordinator** (`core/execution-coordinator.ts`)

Routes execution to appropriate executors. Parameterless constructor (no SecureStorage/ConsentManager dependencies).

**Routing:**
- `mcp` → `McpExecutor`
- `skill` → `SkillExecutor`
- `acp-agent` → `AcpExecutor`

#### **Executors** (`src/executors/`)

| Protocol | Executor | Transport |
|----------|----------|-----------|
| `mcp` | McpExecutor | stdio, streamable-http, SSE |
| `skill` | SkillExecutor | File-based (SKILL.md) |
| `acp-agent` | AcpExecutor | JSON-RPC 2.0 over stdio |

---

### 2.7 Discovery Layer (`src/discovery/`)

Reduced to two concerns:

1. **Availability checks** (`checks.ts`) — `evaluateDescriptorAvailability()` runs discovery checks defined in aai.json descriptors (command path, file exists, directory exists)
2. **Pre-built descriptors** (`descriptors/`) — ACP agent definitions for Claude Code, Codex, OpenCode

---

### 2.8 Storage Layer (`src/storage/`)

Two directories:

**Shared data** (`~/.local/share/aai-gateway/`) — app descriptors, open for other apps to register:

```
~/.local/share/aai-gateway/
├── apps/
│   ├── <appId>/
│   │   └── aai.json          # App descriptor (single source of truth)
│   └── ...
├── mcp-registry.json          # MCP import metadata
└── skill-registry.json        # Skill import metadata
```

**Private config** (`~/.aai-gateway/`) — AAI Gateway's own config and state:

```
~/.aai-gateway/
├── config.json                # Config (logLevel, etc.)
├── .env                       # Sensitive values (${VAR_NAME} placeholders)
├── agents/
│   └── <agentId>.json         # Per-agent state (app overrides)
└── apps/
    └── <appId>.json           # App-wide policy (defaultEnabled, importer)
```

**Key Components:**
- `ManagedRegistry.scan()` — reads all `aai.json` files, runs availability checks, registers to AppRegistry
- `AgentState` — per-agent app overrides (enable/disable)
- `AppPolicyState` — per-app default visibility scope

---

## 3. Key Data Flows

### Startup Flow

```
1. createGatewayServer() creates Gateway instance
2. Gateway.initialize() runs:
   a. seedPrebuiltDescriptors() writes ACP agent aai.json files
   b. ManagedRegistry.scan() reads all aai.json, runs checks, populates AppRegistry
   c. BackgroundTaskManager starts AcpPrewarmTask and TurnCleanupTask
3. MCP server connects stdio transport
```

### Tool Execution Flow

```
1. MCP request → server.ts → Gateway.handleExec()
2. Gateway resolves app via AppRegistry
3. Checks per-agent visibility
4. ExecutionCoordinator routes to correct executor
5. Executor executes and returns result
6. Gateway wraps in GatewayTextResult
7. server.ts converts to MCP CallToolResult
```

### Import Flow (MCP)

```
1. Agent calls mcp:import without summary (inspection phase)
2. Gateway inspects MCP server, lists tools
3. Returns tool list for agent to review
4. Agent calls mcp:import with summary + enableScope (finalize)
5. ImportService saves descriptor and policy
6. App added to AppRegistry
7. notifyToolsListChanged() triggers hot-reload
```

### Progressive Disclosure Flow

```
1. tools/list returns:
   - guide:<app-id> tools (one per visible app, summary only)
   - Gateway management tools
2. Agent calls guide:<app-id> to get full tool schemas
3. Agent calls aai:exec with app + tool + args to execute
```

---

## 4. Key Design Patterns

| Pattern | Usage |
|---------|-------|
| **Progressive Disclosure** | Summary-only tool list → on-demand full schemas |
| **Seed on Startup** | Pre-built descriptors always overwritten from code |
| **aai.json as Single Source of Truth** | All apps (imported, seeded) stored as aai.json |
| **Thin Protocol Layer** | server.ts handles MCP protocol only, delegates to Gateway |
| **Per-Agent Visibility** | AppPolicyState + AgentState control what each agent sees |
| **Singleton Executors** | `getMcpExecutor()`, `getSkillExecutor()` return cached instances |
| **2-Phase Import** | MCP import: inspect tools → finalize with summary |
| **Dotenv for Secrets** | `~/.aai-gateway/.env` with `${VAR_NAME}` placeholders |

---

## 5. Constants

### Timeouts

| Timeout | Duration |
|---------|----------|
| Downstream inactivity | 10 minutes |
| Turn poll wait | 30 seconds |
| Permission request | 5 minutes |
| Turn transition delay | 2 seconds |

### Turn Retention

| Retention | Duration |
|-----------|----------|
| Finished turn cleanup | 7 days |
