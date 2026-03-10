## 1. Type Definitions

- [ ] 1.1 Add `AcpExecution` interface to `src/types/aai-json.ts` with `type: 'acp'` and `start` object containing `command`, `args?`, `env?`
- [ ] 1.2 Update `Execution` union type to include `AcpExecution`
- [ ] 1.3 Add `'acp'` to execution type validation in `src/parsers/schema.ts`

## 2. Agent Registry

- [ ] 2.1 Create `src/discovery/agent-registry.ts` with `AgentDescriptor` and `DiscoveredAgent` interfaces
- [ ] 2.2 Implement `scanInstalledAgents()` function with command existence check
- [ ] 2.3 Implement `checkCommandExists()` helper (uses `which` on Unix, `where` on Windows)
- [ ] 2.4 Create `src/discovery/descriptors/agents/opencode.ts` descriptor
- [ ] 2.5 Create `src/discovery/descriptors/agents/claude-code.ts` descriptor
- [ ] 2.6 Create `src/discovery/descriptors/agents/gemini-cli.ts` descriptor

## 3. ACP Executor

- [ ] 3.1 Create `src/executors/acp.ts` with `AcpExecutor` class
- [ ] 3.2 Implement process spawning with stdio pipes using `descriptor.start.command` and `descriptor.start.args`
- [ ] 3.3 Implement JSON-RPC message sending with newline delimiter
- [ ] 3.4 Implement response parsing with message buffer for partial lines
- [ ] 3.5 Implement `initialize` handshake on first spawn
- [ ] 3.6 Implement request timeout handling (120s default)
- [ ] 3.7 Implement `execute()` method that routes to ACP methods
- [ ] 3.8 Implement `stopAll()` cleanup method
- [ ] 3.9 Export `getAcpExecutor()` singleton function

## 4. MCP Server Integration

- [ ] 4.1 Add `agentRegistry` Map property to `AaiGatewayServer` class
- [ ] 4.2 Call `scanInstalledAgents()` in `initialize()` method
- [ ] 4.3 Add agents to `tools/list` as `app:<agent-id>` entries
- [ ] 4.4 Add agent check in `handleAppGuide()` method
- [ ] 4.5 Implement `generateAgentGuide()` helper method
- [ ] 4.6 Add agent execution branch in `handleExec()` method

## 5. Guide Generator

- [ ] 5.1 Add `'acp'` to platform type in `generateOperationGuide()` signature
- [ ] 5.2 Add ACP-specific guide generation logic (no auth, ACP methods)

## 6. Testing

- [ ] 6.1 Add unit tests for `scanInstalledAgents()` with mocked `exec`
- [ ] 6.2 Add unit tests for `AcpExecutor` with mocked child process
- [ ] 6.3 Add integration test for agent discovery and execution flow

## 7. Documentation

- [ ] 7.1 Update README to list supported ACP agents
- [ ] 7.2 Update AGENTS.md with agent descriptor creation guide
