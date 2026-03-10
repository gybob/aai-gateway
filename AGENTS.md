# AAI Gateway - Agent Maintenance Guide

**Status**: v0.4.0 - ACP Agent Support Added

This guide provides instructions for AI Agents (and human developers) working on the AAI Gateway codebase.

## 1. Project Overview

AAI (Agent App Interface) Gateway acts as a bridge between LLM Agents (via Model Context Protocol) and local applications (via platform-native automation like AppleScript, COM, DBus) **and web applications** (via HTTP with OAuth 2.1 PKCE, API Key, and App Credential auth).

**Goal**: Enable Agents to invoke desktop and web app capabilities without GUI automation.

## 2. Project Structure

- `src/mcp/`: Core MCP Server implementation (`server.ts`).
  - `guide-generator.ts`: Operation guide generation for tools/list.
- `src/executors/`: Platform automation implementations.
  - `ipc/`: IPC-based executors for desktop apps.
  - `web.ts`: HTTP executor for web apps with auth context support.
  - `acp.ts`: ACP (Agent Client Protocol) executor for AI agents.
- `src/discovery/`: App discovery.
  - `web.ts`: Web descriptor fetching with caching.
  - `web-registry.ts`: Built-in web app registry.
  - `descriptors/`: Built-in app descriptors (yuque.ts, notion.ts, feishu.ts).
  - `descriptors/agents/`: Built-in ACP agent descriptors (opencode.ts, claude-code.ts, gemini-cli.ts).
  - `agent-registry.ts`: ACP agent discovery and registry.
  - `macos.ts`: macOS app discovery.
- `src/auth/`: Authentication.
  - `oauth.ts`: OAuth 2.1 PKCE flow.
  - `token-manager.ts`: OAuth token storage and refresh.
- `src/credential/`: Credential management for non-OAuth auth.
  - `manager.ts`: Handles apikey, cookie, app_credential auth.
  - `dialog/`: Platform-specific credential input dialogs.
- `src/consent/`: User consent management.
- `src/storage/`: Secure storage (Keychain on macOS).
- `src/utils/`: Utilities (logger, retry, rate-limiter, metrics, cache).
- `src/parsers/`: JSON Schema definitions and validation.
- `tests/`: Test suite (Unit, Integration, E2E, Performance).

## 3. Development Workflow

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

### Run

```bash
# Run via TS-Node (dev)
npm start -- --mcp

# Run built version
node dist/cli.js --mcp
```

## 4. Protocol Modification Process

**CRITICAL**: This project implements the [AAI Protocol](https://github.com/gybob/aai-protocol). Any changes to `aai.json` schema or related types must follow this process:

### Workflow

```
发现需要修改协议 → 反馈给项目负责人 → 项目负责人决定是否修改 aai-protocol → 代码 follow 协议
```

### Rules

1. **NEVER** add/modify `aai.json` related fields in code without protocol update
2. **NEVER** add fields like `short_zh`, `detailed_zh` to `AuthInstructions` without protocol approval
3. Code in `src/types/aai-json.ts` and `src/parsers/schema.ts` must strictly follow the protocol spec
4. If you find the protocol needs extension, raise the issue first, don't implement in code

### Example

If multi-language instructions are needed:
1. **WRONG**: Add `short_zh?: string` to `AuthInstructions` in code
2. **RIGHT**: Propose the change → Protocol updated → Then update code

---

## 5. Key Maintenance Tasks
### Adding a New Web App Descriptor

1. Create `src/discovery/descriptors/<app>.ts` with:
   - App metadata (id, name, description, aliases)
   - Auth configuration (apikey, oauth2, app_credential, or cookie)
   - Tools list with execution paths
2. Import and register in `src/discovery/web-registry.ts`.
3. Test by running `node dist/cli.js` and calling `web:discover` with the app domain.

### Adding a New Auth Type

1. Add type definition in `src/types/aai-json.ts`.
2. Add validation schema in `src/parsers/schema.ts`.
3. Update `CredentialManager` in `src/credential/manager.ts` to handle the new type.
4. Add dialog support in `src/credential/dialog/` if user input is needed.
5. Update `getWebAuthContext` in `src/mcp/server.ts` to route to correct handler.

### Adding a New Executor (Desktop)

1. Create `src/executors/ipc/<platform>.ts` implementing `IpcExecutor`.
2. Register the executor in `src/executors/ipc/index.ts` factory.
3. Update `src/discovery/<platform>.ts` for app discovery.
4. Update `README.md` documentation.
### Updating Protocol Schema

1. Modify `src/parsers/schema.ts` (Zod definition).
2. Update `README.md` Appendix C (JSON Schema reference).
3. Ensure backward compatibility if possible.

### Improving Web UI

1. Modify `src/web/server.ts` (currently server-side rendered HTML).
2. For complex UI updates, consider extracting frontend to separate React app (Phase 5 plan).

## 6. Testing Guidelines

- **Unit Tests**: Place in `tests/unit/`. Mock external dependencies (fs, child_process).
- **Integration Tests**: Place in `tests/integration/`. Test interaction between components.
- **E2E Tests**: Place in `tests/e2e/`. These require actual platform environment (e.g., macOS with Reminders app).
- **Performance Tests**: Place in `tests/performance/`.

## 7. Release Process

1. Update version in `package.json`.
2. Update `CHANGELOG.md`.
3. Run full test suite: `npm test`.
4. Tag commit with version number (e.g., `v0.1.0`).
5. Publish to npm (if applicable).

---

_Generated by AAI Orchestrator_

When implementing, choose from these recommended stacks:

| Component          | TypeScript Options                   | Python Options                   |
| ------------------ | ------------------------------------ | -------------------------------- |
| MCP Server         | `@modelcontextprotocol/sdk`          | Official Python SDK              |
| aai.json Parsing   | `ajv`                                | `jsonschema`                     |
| macOS Automation   | `osascript` CLI / Node child_process | `pyobjc`                         |
| Windows Automation | `node-ffi-napi` / edge-js            | `pywin32` / `win32com`           |
| Linux Automation   | `dbus-typescript`                    | `dbus-python`                    |
| Build Tool         | `vite` or `rollup`                   | `setuptools` or `pyproject.toml` |
| Testing            | `vitest`                             | `pytest`                         |

---

## Code Style Guidelines (To Be Established)

### When Starting Implementation, Define:

**Naming Conventions** (choose one consistent style):

- camelCase for variables/functions (JavaScript/TypeScript)
- PascalCase for classes/components (JavaScript/TypeScript)
- snake_case for Python

**Import Organization** (if using TypeScript/JavaScript):

```typescript
// 1. Node.js built-ins
import { createServer } from 'http';

// 2. External packages
import { Server } from '@modelcontextprotocol/sdk';

// 3. Internal modules
import { AutomationExecutor } from './executors';
```

**Error Handling**:

- Use structured error types (see Appendix C in README for error code definitions)
- Always include error code and user-friendly message
- Log errors with context

**Type Safety**:

- Use TypeScript strict mode (`"strict": true` in tsconfig.json)
- Define interfaces for all aai.json structures
- Validate JSON schemas at runtime

---

## File Structure Convention (Recommended)

```
src/
├── mcp/
│   ├── server.ts          # MCP server implementation
│   └── handlers/         # resources/list, resources/read, tools/call
├── executors/
│   ├── base.ts           # Abstract executor interface
│   ├── macos.ts         # AppleScript/JXA executor
│   ├── windows.ts       # COM automation executor
│   ├── linux.ts         # DBus executor
│   ├── android.ts       # Intent executor
│   └── ios.ts          # URL Scheme executor
├── parsers/
│   └── aai-parser.ts    # aai.json parser and validator
├── config/
│   └── app-discovery.ts  # App discovery and scanning
├── errors/
│   └── errors.ts        # Custom error types
└── index.ts             # Main entry point
```

---

## Configuration Conventions

### aai.json Location (per protocol spec):

- **macOS/Linux**: `~/.aai/<appId>/aai.json`
- **Windows**: `%USERPROFILE%\.aai\<appId>\aai.json`

### Gateway Config (to be created):

- Location: `~/.aai/config.json`
- Contains: scan paths, timeouts, logging levels

---

## Testing Conventions (To Be Established)

When adding tests:

**Test Structure**:

```typescript
describe('AppleScriptExecutor', () => {
  describe('execute', () => {
    it('should execute AppleScript and return parsed result', async () => {
      // Given
      const script = '...';
      // When
      const result = await executor.execute(script);
      // Then
      expect(result).toEqual({ success: true });
    });
  });
});
```

**Test Categories**:

- Unit tests: Individual executor functions
- Integration tests: MCP server + platform automation
- Schema tests: aai.json validation

---

## Documentation Conventions

### Code Documentation:

- Use JSDoc (TypeScript) or docstrings (Python) for all public APIs
- Document `appId`, `platform`, and tool parameters clearly

### README Updates:

- When adding features, update README's "Roadmap" section
- Document new platform automation methods with examples

---

## Platform-Specific Considerations

**Implementation Status**:
- **macOS**: ✅ Fully implemented (Discovery, IPC, Consent, Storage)
- **Linux**: ✅ Fully implemented
  - Discovery: Scans XDG paths for .desktop files
  - IPC: DBus via gdbus
  - Consent: zenity/kdialog
  - Storage: libsecret via secret-tool
- **Windows**: ✅ Fully implemented
  - Discovery: Scans Program Files, AppData for aai.json
  - IPC: PowerShell COM automation
  - Consent: PowerShell MessageBox
  - Storage: Windows Credential Manager via cmdkey


- AppleScript uses `${param}` syntax for parameter substitution
- First execution triggers TCC authorization popup (document in error messages)
- Use `osascript -e` for single-line scripts or temp files for multi-line
- **Escaping**: `\` → `\\`, `"` → `\"`, `\n` → `\\n`, `\t` → `\\t`

### Windows:

- **Discovery**:
  - Scans `Program Files` and `AppData` directories for `aai.json` files
  - Uses PowerShell `Get-ChildItem` with `-Recurse` for deep scanning
  - Filters by `platform: "windows"` in descriptor
- **IPC**:
  - COM automation via PowerShell scripts
  - Requires ProgID registration (e.g., `Outlook.Application`)
  - May require UAC elevation for certain operations
  - Structured script format: `[{"action": "create", ...}, {"action": "call", ...}]`
- **Consent**:
  - PowerShell MessageBox for user dialogs
  - Supports three-button dialogs (Authorize Once/All/Deny)
  - Follow-up dialog for "Remember this decision"
- **Storage**:
  - Windows Credential Manager via `cmdkey` CLI
  - Stores credentials with target name `aai-gateway/cred/<appId>`
  - Uses PowerShell/.NET for credential retrieval
- **Escaping**: `` ` `` → ` `` `, `"` → `` `" ``, `$` → `` `$ ``

### Linux:

- **Discovery**:
  - Scans XDG paths for `.desktop` files (`/usr/share/applications`, `~/.local/share/applications`)
  - Parses `X-AAI-Config` from desktop entries to locate `aai.json`
  - Filters by `platform: "linux"` in descriptor
- **IPC**:
  - DBus method invocation via `gdbus` CLI
  - Requires service name, object path, and interface
  - Uses session bus for user-level interactions
- **Consent**:
  - Uses `zenity` (GNOME) or `kdialog` (KDE) for dialogs
  - Auto-detects available dialog tool at runtime
- **Storage**:
  - Uses `libsecret` via `secret-tool` CLI
  - Requires `libsecret-tools` package on most distributions
- **Escaping**: `\` → `\\`, `"` → `\"`

### Android:

- Intent requires package name and action string
- Results via ContentProvider or broadcast

### iOS:

- URL Scheme requires custom scheme registration
- Results via App Groups or clipboard

---

## Parameter Transform Rules

The Gateway uses `param-transform.ts` for secure parameter handling:

### Type Transformations

| Type      | AppleScript   | PowerShell     | DBus                        |
| --------- | ------------- | -------------- | --------------------------- |
| `boolean` | `true/false`  | `$true/$false` | `boolean:true`              |
| `number`  | `42`          | `42`           | `int32:42` or `double:3.14` |
| `string`  | escaped value | escaped value  | `string:"value"`            |
| `array`   | `{"a", "b"}`  | `@("a", "b")`  | JSON string                 |

### Security: Injection Prevention

All string parameters are escaped before substitution:

```typescript
// Input: 'Hello"; do shell script "rm -rf /"'
// Escaped: 'Hello\\"; do shell script \\"rm -rf /\\"'
// Result: Safe string in script
```

### Validation

Parameters are validated against JSON Schema before execution:

```typescript
validateParamTypes(args, tool.parameters);
// Returns: { valid: boolean, errors: string[] }
```

---

## Security Best Practices (from README)

**Critical**: Use OS-native security - DO NOT implement custom auth:

- macOS: Relies on TCC (Transparency, Consent, and Control)
- Windows: Relies on UAC or app's own COM security
- Linux: Relies on Polkit
- Android: Runtime permissions
- iOS: Sandbox + URL Scheme restrictions

**Never**:

- Implement custom authentication protocols
- Store credentials in Gateway
- Bypass OS security mechanisms

---

## Error Handling Patterns

Use standardized error codes from Appendix C in README:

```typescript
class AutomationError extends Error {
  constructor(code: number, message: string, detail?: string) {
    super(message);
    this.name = 'AutomationError';
    this.code = code;
    this.detail = detail;
  }
}

// Usage:
throw new AutomationError(-32001, 'Automation failed', 'Script execution timed out');
```

**Common Error Codes**:

- `-32001`: AUTOMATION_FAILED
- `-32002`: APP_NOT_FOUND
- `-32004`: PERMISSION_DENIED
- `-32008`: TIMEOUT

---

## Debugging Guidelines

**Logging** (to be implemented):

- Structured JSON logs for automated parsing
- Log levels: DEBUG, INFO, WARN, ERROR
- Include context: `appId`, `tool`, `platform`, `duration`

**Common Issues**:

- **TCC authorization failed** (macOS): User denied, check System Settings > Privacy
- **COM not registered** (Windows): App doesn't support automation
- **DBus service not found** (Linux): App not running or not installed

---

## MCP Integration Notes

Gateway implements MCP over stdio (not HTTP):

**Resource Model** (progressive loading):

- `resources/list` → Returns all available apps (`app:com.apple.mail`, etc.)
- `resources/read` → Returns specific app's aai.json content
- `tools/call` → Executes tool with parameters

**Why Progressive?** Avoids context explosion - only load app's tools when agent mentions it.

---

## Verification Checklist (for each PR)

Before submitting changes:

- [ ] All tests pass
- [ ] TypeScript compiles with no errors
- [ ] Linting passes (ESLint/flake8)
- [ ] Code follows naming conventions
- [ ] Error handling uses standardized error codes
- [ ] Platform-specific code is isolated to executor files
- [ ] Documentation updated (README or inline docs)
- [ ] aai.json schema changes are backward compatible

---

## Key Architectural Decisions (From Protocol Spec)

**Zero Intrusion Design**:

- Gateway doesn't modify target apps
- Leverages existing automation (AppleScript/COM/DBus)
- No HTTP server required (MCP over stdio only)

**Platform Native Automation**:

- Don't implement custom IPC
- Use what each OS provides natively

**Progressive Tool Discovery**:

- Don't load all apps/tools at startup
- Load on-demand via MCP resources

---

## Getting Started with Implementation

### Step 1: Initialize Project

```bash
npm init -y  # or: python -m venv venv
npm install @modelcontextprotocol/sdk  # or: pip install mcp
```

### Step 2: Create Basic Structure

```
src/
├── server.ts          # Minimal MCP server
├── executors/
│   └── macos.ts      # Start with one platform
└── aai-parser.ts      # Parse aai.json
```

### Step 3: Test Sample aai.json

Create `~/.aai/com.apple.mail/aai.json` (see README example)

### Step 4: Implement MCP Handlers

```typescript
async function handleToolCall(name: string, args: any) {
  const [appId, tool] = name.split(':');
  const config = await loadAaiConfig(appId);
  const executor = getExecutor(config.platform);
  return await executor.execute(tool, args);
}
```

---

## Contact & Contribution

This protocol is in early design phase. Implementation patterns will evolve as we build.

**Before making architectural changes**:

1. Read README.md Section 2 (Technical Specifications) thoroughly
2. Check Appendix B (Implementation Reference)
3. Verify change doesn't break "Zero Intrusion" principle

---

_Last Updated: 2025-03-08_
---

## Web App Support (v0.2.0)

### Built-in Web Apps

The gateway includes built-in descriptors for popular web apps:

| App | Auth Type | Description |
|-----|-----------|-------------|
| Yuque (语雀) | API Key | Knowledge management platform |
| Notion | API Key | All-in-one workspace |
| Feishu (飞书) | App Credential | Enterprise collaboration |

### Web App Registry

Built-in descriptors are registered in `src/discovery/web-registry.ts`:

```typescript
import { notionDescriptor } from './descriptors/notion.js';

WEB_APP_REGISTRY.set('notion.com', notionDescriptor);
WEB_APP_REGISTRY.set('notion', notionDescriptor);
```

### Authentication Types

#### 1. API Key (`apikey`)

For services that use static API tokens:

```json
{
  "auth": {
    "type": "apikey",
    "apikey": {
      "location": "header",
      "name": "Authorization",
      "prefix": "Bearer",
      "obtain_url": "https://example.com/settings/tokens",
      "instructions": {
        "short": "Get your API key from settings",
        "help_url": "https://example.com/docs/api"
      }
    }
  }
}
```

#### 2. App Credential (`app_credential`)

For services that use app ID + secret to obtain tokens:

```json
{
  "auth": {
    "type": "app_credential",
    "appCredential": {
      "token_endpoint": "https://api.example.com/auth/token",
      "token_type": "tenant_access_token",
      "expires_in": 7200,
      "instructions": {
        "short": "Get App ID and Secret from developer console"
      }
    }
  }
}
```

#### 3. OAuth 2.0 (`oauth2`)

For services supporting OAuth 2.0 with PKCE:

```json
{
  "auth": {
    "type": "oauth2",
    "oauth2": {
      "authorization_endpoint": "https://example.com/oauth/authorize",
      "token_endpoint": "https://example.com/oauth/token",
      "scopes": ["read", "write"],
      "pkce": { "method": "S256" }
    }
  }
}
```

#### 4. Cookie (`cookie`)

For services without official API:

```json
{
  "auth": {
    "type": "cookie",
    "cookie": {
      "login_url": "https://example.com/login",
      "required_cookies": ["session", "auth_token"],
      "domain": ".example.com"
    }
  }
}
```

### Credential Dialog

When credentials are needed, the gateway shows a native dialog:

- **macOS**: Uses `osascript` for native dialog
- **Windows**: Uses PowerShell `Get-Credential` and custom WinForms dialog
- **Linux**: Uses `zenity` (GNOME) or `kdialog` (KDE)

Dialog includes:
- App name and instructions
- Help URL button
- Input field for credential
---
_Protocol Version: 1.0_

---

## ACP Agent Support (v0.4.0)

### Overview

AAI Gateway now supports ACP (Agent Client Protocol) compatible AI agents like OpenCode, Claude Code, and Gemini CLI. These agents are discovered automatically and can be invoked through the standard `aai:exec` interface.

### How It Works

1. **Discovery**: At startup, AAI Gateway scans for installed ACP agents by checking if known commands (`opencode`, `claude`, `gemini`) exist on the system.
2. **Registration**: Found agents appear as `app:<agent-id>` entries in `tools/list`.
3. **Execution**: When `aai:exec` is called with an agent ID, the gateway:
   - Starts the agent process (if not already running)
   - Sends JSON-RPC requests via stdio
   - Returns the agent's response

### Supported Agents

| Agent | App ID | Command | Description |
|-------|--------|---------|-------------|
| OpenCode | `dev.sst.opencode` | `opencode` | Open-source AI coding agent |
| Claude Code | `anthropic.claude-code` | `claude` | Anthropic's CLI coding assistant |
| Gemini CLI | `google.gemini-cli` | `gemini` | Google's AI CLI tool |

### Adding a New ACP Agent

1. Create `src/discovery/descriptors/agents/<agent>.ts` with:
   ```typescript
   import type { AgentDescriptor } from '../../agent-registry.js';

   export const myAgentDescriptor: AgentDescriptor = {
     id: 'com.example.my-agent',
     name: { en: 'My Agent' },
     description: 'Description of the agent',
     defaultLang: 'en',
     aliases: ['myagent', 'ma'],
     start: {
       command: 'my-agent',
       args: [],
       env: {},
     },
     tools: [
       {
         name: 'session/new',
         description: 'Start a new session',
         parameters: { type: 'object', properties: {} },
       },
       {
         name: 'session/prompt',
         description: 'Send a prompt to the agent',
         parameters: {
           type: 'object',
           properties: {
             message: { type: 'string', description: 'The prompt message' },
           },
           required: ['message'],
         },
       },
     ],
   };
   ```

2. Import and add to `BUILTIN_AGENTS` array in `src/discovery/agent-registry.ts`.

3. Test by running the gateway and checking `tools/list` output.

### ACP Protocol Details

ACP agents communicate via stdio-based JSON-RPC:

**Request Format:**
```json
{"jsonrpc": "2.0", "id": 1, "method": "session/prompt", "params": {...}}
```

**Response Format:**
```json
{"jsonrpc": "2.0", "id": 1, "result": {...}}
```

**Common Methods:**
- `initialize` - Handshake with the agent
- `session/new` - Create a new coding session
- `session/prompt` - Send a prompt to the agent
- `session/update` - Streaming response notifications

### Execution Flow

```
1. User requests: aai:exec({app: "dev.sst.opencode", tool: "session/prompt", args: {...}})
2. Gateway checks if agent process is running
3. If not, spawns: opencode --mcp
4. Sends initialize request
5. Sends session/prompt request
6. Returns response to user
```

### ACP vs MCP

Both ACP and MCP are stdio-based JSON-RPC protocols:
- **MCP**: Used by AAI Gateway to communicate with LLM clients (Claude Desktop, Cursor, etc.)
- **ACP**: Used by AAI Gateway to communicate with AI agents (OpenCode, Claude Code, etc.)

The key difference is in tool descriptions:
- MCP tools are described with `tools/list` returning all tools
- ACP agents have session-based tools (`session/new`, `session/prompt`) that return different results based on context

---
_Last Updated: 2026-03-10_
