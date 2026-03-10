## Context

AAI Gateway currently supports two application categories:

1. **Desktop Apps**: Discovered by scanning for `aai.json` in application bundles, executed via platform IPC (AppleScript/COM/DBus)
2. **Web Apps**: User-specified via URL, descriptor fetched from `.well-known/aai.json` or built-in registry, executed via HTTP

ACP (Agent Client Protocol) is a JSON-RPC 2.0 protocol for connecting code editors to coding agents. Popular agents like OpenCode, Claude Code, Gemini CLI support ACP via stdio transport.

## Goals / Non-Goals

**Goals:**

- Support ACP agents as a third application category
- Reuse existing `app:<id>` and `aai:exec` patterns for minimal code changes
- Discover agents by checking if their commands exist on the system
- Execute agents via stdio-based JSON-RPC (ACP protocol)

**Non-Goals:**

- ACP over HTTP transport (stdio only for now)
- Implementing ACP Agent server (we're a client only)
- MCP-over-ACP integration (out of scope)
- Dynamic agent discovery (we use built-in registry + install check)

## Technical Design

### 1. Type Extension

**Add `AcpExecution` to execution types:**

```typescript
// src/types/aai-json.ts

interface AcpExecution {
  type: 'acp';
  start: {
    command: string; // e.g., 'opencode', 'claude'
    args?: string[]; // Optional arguments
    env?: Record<string, string>; // Optional environment variables
  };
}

// Update union type
type Execution = DesktopExecution | WebExecution | AcpExecution;
```

**Example aai.json for ACP agent:**

```json
{
  "execution": {
    "type": "acp",
    "start": {
      "command": "opencode",
      "args": []
    }
  }
}
```

**Comparison with other execution types:**

```json
// HTTP execution
{
  "execution": {
    "type": "http",
    "baseUrl": "https://api.notion.com/v1",
    "defaultHeaders": { "Notion-Version": "2022-06-28" }
  }
}

// IPC execution (desktop)
{
  "execution": {
    "type": "ipc"
  }
}
```

**Rationale**:

- `start` groups all process startup configuration together
- Follows MCP's `command` + `args` pattern within a structured object
- Extensible: can add `env`, `cwd`, etc. to `start` without breaking changes
- Each execution type has its own structure based on what it needs

### 2. Agent Discovery

**Built-in registry + install check:**

```typescript
// src/discovery/agent-registry.ts

interface AgentDescriptor {
  id: string;
  name: Record<string, string>;
  defaultLang: string;
  description: string;
  aliases?: string[];
  start: {
    command: string;
    args?: string[];
  };
  tools: Array<{ name: string; description: string; parameters: object }>;
}

interface DiscoveredAgent {
  appId: string;
  name: string;
  description: string;
  descriptor: AgentDescriptor;
  commandPath: string;
}

// Built-in agents
const BUILTIN_AGENTS: AgentDescriptor[] = [
  { id: 'dev.sst.opencode', start: { command: 'opencode' }, ... },
  { id: 'com.anthropic.claude-code', start: { command: 'claude' }, ... },
  ...
];

// Discovery: check if command exists
async function scanInstalledAgents(): Promise<DiscoveredAgent[]> {
  for (agent of BUILTIN_AGENTS) {
    const path = await checkCommandExists(agent.start.command);
    if (path) discovered.push(agent);
  }
}
```

**Rationale**: Unlike desktop apps (scan for aai.json) or web apps (user-specified), agents are discovered by checking if known commands exist.

### 3. Agent Execution

**Stdio-based JSON-RPC (ACP protocol):**

```typescript
// src/executors/acp.ts

class AcpExecutor {
  private processes = new Map<string, ChildProcess>();

  async execute(descriptor: AgentDescriptor, method: string, params: object) {
    // 1. Ensure process is running
    const proc = await this.ensureProcess(descriptor);

    // 2. Send JSON-RPC request (ACP protocol)
    proc.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: ++this.requestId,
        method, // e.g., 'session/new', 'session/prompt', 'tools/call'
        params,
      }) + '\n'
    );

    // 3. Wait for response
    return this.waitForResponse(id);
  }
}
```

**Rationale**: ACP uses JSON-RPC 2.0 over stdio. Each agent process is spawned once and reused. The method to call is defined by descriptor.tools.

### 4. MCP Server Integration

**Add agentRegistry alongside desktopRegistry:**

```typescript
// src/mcp/server.ts

class AaiGatewayServer {
  private desktopRegistry = new Map<string, DiscoveredDesktopApp>();
  private agentRegistry = new Map<string, DiscoveredAgent>(); // NEW

  async initialize() {
    // ... existing desktop scan ...

    // NEW: scan agents
    const agents = await scanInstalledAgents();
    for (const agent of agents) {
      this.agentRegistry.set(agent.appId, agent);
    }
  }

  // tools/list: add agents as app:<id>
  // tools/call: handleAppGuide checks both registries
  // handleExec: route to AcpExecutor for agents
}
```

**Rationale**: Minimal changes - agents are treated like desktop apps but with different execution path.

### 5. Guide Generation

**Add 'acp' platform support:**

```typescript
// src/mcp/guide-generator.ts

function generateOperationGuide(appId, descriptor, platform: 'desktop' | 'web' | 'acp') {
  if (platform === 'acp') {
    // Agent-specific guide: no auth, ACP methods
  }
}
```

### 6. File Structure

```
src/
├── types/aai-json.ts           # Add AcpExecution (10 lines)
├── parsers/schema.ts           # Add 'acp' to execution type (5 lines)
├── discovery/
│   ├── agent-registry.ts       # NEW: Agent discovery
│   └── descriptors/agents/     # NEW: Built-in agent descriptors
│       ├── opencode.ts
│       ├── claude-code.ts
│       └── gemini-cli.ts
├── executors/
│   └── acp.ts                  # NEW: ACP stdio executor
└── mcp/
    ├── server.ts               # Add agentRegistry, routing (30 lines)
    └── guide-generator.ts       # Add 'acp' platform (10 lines)
```

## Risks / Trade-offs

| Risk                                | Mitigation                                                           |
| ----------------------------------- | -------------------------------------------------------------------- |
| Agent process management complexity | Simple spawn-on-demand with cleanup on exit                          |
| JSON-RPC message parsing edge cases | Strict newline-delimited parsing, error logging                      |
| Agent command not in PATH           | Clear error message: "Agent 'opencode' not found. Install it first." |
| Agent version compatibility         | ACP protocol version negotiation during initialize                   |
