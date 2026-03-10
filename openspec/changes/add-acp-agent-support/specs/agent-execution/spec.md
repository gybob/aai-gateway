# ACP Execution Type

## Overview

Add `acp` as a new execution type in AAI Gateway to support ACP (Agent Client Protocol) agents.

## Type Definition

```typescript
// src/types/aai-json.ts

interface AcpExecution {
  type: 'acp';
  start: {
    command: string; // e.g., 'opencode', 'claude'
    args?: string[]; // Optional command arguments
    env?: Record<string, string>; // Optional environment variables
  };
}
```

## Schema Validation

```typescript
// src/parsers/schema.ts

const AcpStartSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

const ExecutionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ipc') }),
  z.object({ type: z.literal('http'), baseUrl: z.string(), ... }),
  z.object({
    type: z.literal('acp'),
    start: AcpStartSchema,
  }),
]);
```

## Usage in Descriptor

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

## Comparison with Other Execution Types

```json
// IPC execution (desktop apps)
{
  "execution": {
    "type": "ipc"
  }
}

// HTTP execution (web apps)
{
  "execution": {
    "type": "http",
    "baseUrl": "https://api.notion.com/v1",
    "defaultHeaders": {
      "Notion-Version": "2022-06-28"
    }
  }
}

// ACP execution (agents)
{
  "execution": {
    "type": "acp",
    "start": {
      "command": "opencode",
      "args": [],
      "env": {
        "DEBUG": "1"
      }
    }
  }
}
```

## Executor Interface

```typescript
// src/executors/acp.ts

interface AcpExecutor {
  execute(
    descriptor: AgentDescriptor,
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown>;
}
```

## Protocol Semantics

The execution type only defines transport (stdio + JSON-RPC). The actual methods to call are defined in `descriptor.tools`:

- **ACP-native agent**: tools = `session/new`, `session/prompt`, `session/load`
- **MCP-over-ACP**: tools = `tools/list`, `tools/call`, `resources/list`

This allows the same `type: 'acp'` to support different agent types.

## Dependencies

- None (new type, no dependencies)
