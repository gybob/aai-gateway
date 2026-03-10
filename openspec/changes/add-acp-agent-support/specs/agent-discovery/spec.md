# Agent Discovery

## Overview

Implement ACP Agent discovery by checking if known agent commands exist on the system.

## Built-in Registry

```typescript
// src/discovery/agent-registry.ts

interface AgentDescriptor {
  id: string; // e.g., 'dev.sst.opencode'
  name: Record<string, string>; // Localized names
  defaultLang: string;
  description: string;
  aliases?: string[];
  start: {
    command: string; // e.g., 'opencode'
    args?: string[];
    env?: Record<string, string>;
  };
  tools: Array<{
    name: string; // ACP method name
    description: string;
    parameters: object;
  }>;
}

interface DiscoveredAgent {
  appId: string;
  name: string;
  description: string;
  descriptor: AgentDescriptor;
  commandPath: string; // Resolved command path
}
```

## Discovery Process

```typescript
async function scanInstalledAgents(): Promise<DiscoveredAgent[]> {
  const discovered: DiscoveredAgent[] = [];

  for (const agent of BUILTIN_AGENTS) {
    const commandPath = await checkCommandExists(agent.start.command);
    if (commandPath) {
      discovered.push({
        appId: agent.id,
        name: localize(agent.name),
        description: agent.description,
        descriptor: agent,
        commandPath,
      });
    }
  }

  return discovered;
}

async function checkCommandExists(command: string): Promise<string | null> {
  const checkCmd = process.platform === 'win32' ? `where ${command}` : `which ${command}`;
  // Returns path if exists, null otherwise
}
```

## Built-in Agents

| Agent ID                  | Command  | Description                 |
| ------------------------- | -------- | --------------------------- |
| dev.sst.opencode          | opencode | Open-source AI coding agent |
| com.anthropic.claude-code | claude   | Anthropic's coding agent    |
| com.google.gemini-cli     | gemini   | Google's Gemini CLI         |
| com.kodemax.cline         | cline    | Cline coding agent          |

## Agent Tools

Each agent descriptor defines its available tools (ACP methods):

**ACP-native agents** (OpenCode, Claude Code, Gemini CLI):

- `session/new` - Create new session
- `session/prompt` - Send prompt to session
- `session/load` - Load existing session
- `session/cancel` - Cancel ongoing operation

**MCP-over-ACP agents** (future):

- `tools/list` - List available tools
- `tools/call` - Execute a tool
- `resources/list` - List resources

Both use `type: 'acp'` in execution - the difference is only in the tool definitions.

## MCP Integration

Agents are registered in `agentRegistry` and appear as `app:<agent-id>` in tools/list.

## Dependencies

- None (standalone discovery)
