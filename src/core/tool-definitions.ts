/**
 * Gateway Tool Definitions
 *
 * Defines the MCP tool schemas exposed by AAI Gateway.
 * Separated from protocol handling for clarity.
 */

import { getDotenvPath } from '../utils/dotenv.js';

import { EXPOSURE_LIMITS, IMPORT_LIMITS } from './importer.js';
import {
  SEARCH_DISCOVER_TOOL_NAME,
  searchDiscoverInputSchema,
} from './search-guidance.js';

export interface GatewayToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  listInputSchema?: Record<string, unknown>;
}

export function buildGatewayToolDefinitions(): GatewayToolDefinition[] {
  return [
    {
      name: 'aai:exec',
      description:
        'Execute any AAI tool action. Read the guide first (call app:*, mcp:import, skill:import, or search:discover) — it contains the required schema and parameters.',
      inputSchema: {
        type: 'object',
        properties: {
          app: {
            type: 'string',
            description: 'Required for app tools, omit or use "gateway" for gateway tools.',
          },
          tool: {
            type: 'string',
            description: 'Tool name within the app, not prefixed with app id.',
          },
          args: {
            type: 'object',
            additionalProperties: true,
            description: 'Arguments for the selected tool.',
          },
        },
        required: ['tool'],
      },
    },
    {
      name: 'mcp:import',
      description: 'Import an MCP server as a GLOBAL app (visible to all projects). For project-level MCP, use your agent\'s native config instead (e.g. .mcp.json, .cursor/mcp.json). Call this first to get the import guide. Never ask the user for API keys or secrets in chat.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: `Optional. Display name for the imported app. Maximum length: ${IMPORT_LIMITS.nameLength} characters.`,
          },
          transport: {
            type: 'string',
            enum: ['streamable-http', 'sse'],
            description:
              'Optional. Only used with url for remote MCP imports. Defaults to "streamable-http".',
          },
          command: {
            type: 'string',
            description: `Use this for a local stdio MCP import. The executable to launch. Maximum length: ${IMPORT_LIMITS.commandLength} characters.`,
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: `Optional for local stdio MCP imports. Command arguments. Maximum ${IMPORT_LIMITS.argCount} items, each at most ${IMPORT_LIMITS.argLength} characters.`,
          },
          env: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: `Optional for local stdio MCP imports. Environment variables. Maximum ${IMPORT_LIMITS.envCount} entries.`,
          },
          cwd: {
            type: 'string',
            description: `Optional for local stdio MCP imports. Working directory. Maximum length: ${IMPORT_LIMITS.cwdLength} characters.`,
          },
          timeout: {
            type: 'integer',
            description: `Optional. MCP tool execution timeout in milliseconds. Default 60000. Maximum: ${IMPORT_LIMITS.timeoutMsMax}.`,
          },
          url: {
            type: 'string',
            description: `Use this for a remote MCP import. The remote MCP endpoint URL. Maximum length: ${IMPORT_LIMITS.urlLength} characters.`,
          },
          headers: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description:
              'Optional for remote MCP imports. HTTP headers (e.g. Authorization). Use ${VAR_NAME} placeholders for sensitive values.',
          },
          summary: {
            type: 'string',
            description: `Optional on first call, required on second. Short English summary. Maximum length: ${EXPOSURE_LIMITS.summaryLength} characters.`,
          },
          enableScope: {
            type: 'string',
            enum: ['current', 'all'],
            description:
              'Optional on first call, required on second. "current" for current agent only, "all" for all agents.',
          },
        },
        examples: [
          {
            name: 'Playwright',
            command: 'npx',
            args: ['@playwright/mcp@latest'],
          },
          {
            name: 'open-websearch',
            command: 'npx',
            args: ['-y', 'open-websearch@latest'],
            env: { MODE: 'stdio', DEFAULT_SEARCH_ENGINE: 'bing' },
            timeout: 30000,
          },
          {
            url: 'https://example.com/mcp',
            summary: 'Use this MCP for Linear issue and project operations.',
            enableScope: 'all',
          },
          {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/repo'],
            summary: 'Use this MCP for local filesystem operations.',
            enableScope: 'current',
          },
        ],
      },
      listInputSchema: buildGuideOnlyInputSchema(),
    },
    {
      name: 'skill:import',
      description: 'Import a local skill as a GLOBAL app (visible to all projects). For project-level skills, use your agent\'s native skill directory instead (e.g. .claude/skills/). Call this first to get the import guide.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: `Required. Path to a local directory containing SKILL.md. Maximum length: ${IMPORT_LIMITS.pathLength} characters.`,
          },
        },
        examples: [{ path: '/absolute/path/to/skill' }],
      },
      listInputSchema: buildGuideOnlyInputSchema(),
    },
    {
      name: 'listAllAaiApps',
      description:
        'List imported apps (MCP servers and skills) for the current agent. This does not include built-in tools like search:discover, mcp:import, or skill:import — those are always available.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'disableApp',
      description:
        'Disable one app for the current agent only. If you do not know the app id, call listAllAaiApps first to find it.',
      inputSchema: {
        type: 'object',
        properties: {
          app: {
            type: 'string',
            description: 'Required. The app id to disable. Use listAllAaiApps to look up available app ids.',
          },
        },
        required: ['app'],
      },
    },
    {
      name: 'enableApp',
      description:
        'Enable or re-enable an app for the current agent. When the user asks to enable, start, turn on, or use a specific app by name, call listAllAaiApps first to check if it is already imported before searching for new tools.',
      inputSchema: {
        type: 'object',
        properties: {
          app: {
            type: 'string',
            description: 'Required. The app id to re-enable. Use listAllAaiApps to look up available app ids.',
          },
        },
        required: ['app'],
      },
    },
    {
      name: 'removeApp',
      description:
        'Remove one AAI Gateway managed import from all agents. If you do not know the app id, call listAllAaiApps first to find it.',
      inputSchema: {
        type: 'object',
        properties: {
          app: {
            type: 'string',
            description: 'Required. The imported app id to remove globally. Use listAllAaiApps to look up available app ids.',
          },
          confirm: {
            type: 'boolean',
            description:
              'Required. Must be true only after the agent explains the global impact and the user explicitly confirms.',
          },
        },
        required: ['app', 'confirm'],
      },
    },
    {
      name: 'getAppConfig',
      description:
        'Get the full configuration of an imported app plus ready-to-share install snippets. Use this when: (1) the user wants to inspect or check an app\'s config, or (2) the user wants to share an app\'s install instructions with someone else (e.g. via chat or email). Secrets are masked as ${VAR_NAME} and required env vars are listed. Works for both MCP and skill apps. If you do not know the app id, call listAllAaiApps first.',
      inputSchema: {
        type: 'object',
        properties: {
          app: {
            type: 'string',
            description: 'Required. The app id. Use listAllAaiApps to look up available app ids.',
          },
          format: {
            type: 'string',
            enum: ['aai', 'mcp-json', 'all'],
            description:
              'Optional. Install snippet format. "aai" = aai-gateway mcp:import args (recipient also uses aai-gateway), "mcp-json" = standard mcpServers JSON (Claude .mcp.json / Cursor), "all" = both. Defaults to "all". MCP only; skills have no install snippet.',
          },
        },
        required: ['app'],
      },
    },
    {
      name: 'updateAppConfig',
      description:
        'Update an imported MCP server\'s configuration. Only provided fields are applied; all others are preserved — so the user can change a single parameter (e.g. add an arg, set a timeout) without re-entering the whole config. Use this instead of remove + re-import when modifying an existing MCP. Only MCP apps are supported (not skills). Env and headers, when provided, replace the existing values. After updating, call the app to verify it still works. If you do not know the app id, call listAllAaiApps first.',
      inputSchema: {
        type: 'object',
        properties: {
          app: {
            type: 'string',
            description: 'Required. The MCP app id to update. Use listAllAaiApps to look it up.',
          },
          command: {
            type: 'string',
            description: 'stdio MCP only. New executable, e.g. "npx", "uvx".',
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'stdio MCP only. New command arguments. Replaces the existing args.',
          },
          env: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description:
              'stdio MCP only. New environment variables. Replaces the existing env. Use ${VAR_NAME} placeholders for secrets (stored in the AAI env file), never paste raw keys.',
          },
          cwd: {
            type: 'string',
            description: 'stdio MCP only. New working directory.',
          },
          timeout: {
            type: 'integer',
            description: 'Tool execution timeout in milliseconds.',
          },
          url: {
            type: 'string',
            description: 'remote MCP only. New endpoint URL.',
          },
          headers: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description:
              'remote MCP only. New HTTP headers. Replaces the existing headers. Use ${VAR_NAME} placeholders for secrets.',
          },
          transport: {
            type: 'string',
            enum: ['streamable-http', 'sse'],
            description: 'remote MCP only. New transport.',
          },
          name: {
            type: 'string',
            description: 'Optional. New display name.',
          },
          summary: {
            type: 'string',
            description: 'Optional. New short English summary of when to use this MCP.',
          },
        },
        required: ['app'],
      },
    },
    {
      name: SEARCH_DISCOVER_TOOL_NAME,
      description:
        'Find and install new tools. Call this when: 1. The user explicitly asks to search for or install tools. 2. The user\'s request cannot be fulfilled by any currently available tool — proactively suggest and search for a suitable tool. Before searching, check listAllAaiApps first — the user may already have the app imported (possibly disabled).',
      inputSchema: searchDiscoverInputSchema,
      listInputSchema: buildGuideOnlyInputSchema(),
    },
  ];
}

function buildGuideOnlyInputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };
}

export function getGatewayToolDefinition(toolName: string): GatewayToolDefinition | undefined {
  return buildGatewayToolDefinitions().find((tool) => tool.name === toolName);
}

export function isGatewayExecutionTool(toolName: string): boolean {
  return (
    toolName === 'mcp:import' ||
    toolName === 'skill:import' ||
    toolName === SEARCH_DISCOVER_TOOL_NAME ||
    toolName === 'listAllAaiApps' ||
    toolName === 'disableApp' ||
    toolName === 'enableApp' ||
    toolName === 'removeApp' ||
    toolName === 'getAppConfig' ||
    toolName === 'updateAppConfig'
  );
}

export function generateGatewayToolGuide(tool: GatewayToolDefinition): string {
  if (tool.name === 'mcp:import') {
    return generateMcpImportGuide(tool);
  }
  if (tool.name === 'skill:import') {
    return generateSkillImportGuide(tool);
  }

  const examples = extractGuideExamples(tool.inputSchema, tool.name);
  return [
    `# ${tool.name}`,
    '',
    `> **Important**: Do NOT call \`${tool.name}\` directly with arguments. It will only return this guide.`,
    `> To perform the actual operation, you must call the \`aai:exec\` tool (another tool in this same MCP server).`,
    '',
    'The `aai:exec` tool accepts three parameters: `app`, `tool`, and `args`.',
    `For this operation, leave \`app\` empty, set \`tool\` to "${tool.name}", and refer to the examples below for \`args\`.`,
    '',
    ...(examples.length > 0
      ? [
          '',
          '## Examples',
          '',
          'The examples below are complete `aai:exec` calls.',
          '',
          ...examples.flatMap((example) => [
            '```json',
            JSON.stringify(
              { tool: 'aai:exec', args: { tool: tool.name, args: example } },
              null,
              2
            ),
            '```',
            '',
          ]),
        ]
      : []),
  ].join('\n');
}

function generateSkillImportGuide(tool: GatewayToolDefinition): string {
  const example = {
    tool: 'aai:exec',
    args: {
      tool: 'skill:import',
      args: { path: '/absolute/path/to/skill-directory', enableScope: 'all' },
    },
  };

  return [
    `# ${tool.name}`,
    '',
    '> **Important**: Do NOT call `skill:import` directly with arguments. It will only return this guide.',
    '> To perform the actual import, you must call the `aai:exec` tool (another tool in this same MCP server).',
    '',
    '## Global vs Project-Level Skills',
    '',
    '`skill:import` imports a skill **globally** — it becomes visible across all projects.',
    'Use this for skills that are not tied to any specific project (e.g. a universal code review workflow).',
    '',
    'For **project-level** skills that only apply to a specific codebase, use your agent\'s native skill directory instead:',
    '',
    '| Agent | Project-level skill path |',
    '|-------|------------------------|',
    '| Claude Code | `.claude/skills/<name>/SKILL.md` |',
    '| Cursor | `.cursor/skills/<name>/SKILL.md` |',
    '| Codex CLI | `.codex/skills/<name>/SKILL.md` |',
    '| VS Code Copilot | `.github/prompts/<name>.prompt.md` |',
    '| Windsurf | `.windsurf/workflows/<name>.md` |',
    '| Cline | `.clinerules/workflows/<name>.md` |',
    '',
    'Project-level skills support slash-command invocation (`/name`) and are version-controlled with the repo.',
    '',
    '## How to Import a Global Skill',
    '',
    'The `aai:exec` tool accepts three parameters: `app`, `tool`, and `args`.',
    'For this import, leave `app` empty, set `tool` to `"skill:import"`, and pass the skill directory path in `args`.',
    '',
    '**Before importing**, ask the user whether this skill should be enabled for the current agent only or for all agents.',
    '',
    '## Examples',
    '',
    '```json',
    JSON.stringify(example, null, 2),
    '```',
    '',
    '| Parameter | Type | Required | Description |',
    '|-----------|------|----------|-------------|',
    '| `path` | string | yes | Absolute path to a directory containing a `SKILL.md` file |',
    '| `enableScope` | `"current"` \\| `"all"` | no | Enable for current agent or all agents (default: `"current"`) |',
  ].join('\n');
}

function generateMcpImportGuide(tool: GatewayToolDefinition): string {
  const inspectExample = {
    tool: 'aai:exec',
    args: {
      tool: 'mcp:import',
      args: {
        command: 'npx',
        args: ['-y', '@brave/brave-search-mcp-server'],
        timeout: 60000,
        name: 'brave-search',
      },
    },
  };

  const finalizeExample = {
    tool: 'aai:exec',
    args: {
      tool: 'mcp:import',
      args: {
        command: 'npx',
        args: ['-y', '@brave/brave-search-mcp-server'],
        timeout: 60000,
        name: 'brave-search',
        summary: 'Use this MCP for Brave web search.',
        enableScope: 'all',
      },
    },
  };

  const envFile = getDotenvPath();

  return [
    `# ${tool.name}`,
    '',
    '> **Important**: Do NOT call `mcp:import` directly with arguments. It will only return this guide.',
    '> To perform the actual import, you must call the `aai:exec` tool (another tool in this same MCP server).',
    '',
    '## Global vs Project-Level MCP',
    '',
    '`mcp:import` imports an MCP server **globally** — it becomes visible across all projects and all agents.',
    'Use this for MCP servers you want available everywhere (e.g. web search, image generation).',
    '',
    'For **project-level** MCP servers that only apply to a specific codebase, use your agent\'s native config instead:',
    '',
    '| Agent | Project-level MCP config |',
    '|-------|------------------------|',
    '| Claude Code | `.mcp.json` (project root) |',
    '| Cursor | `.cursor/mcp.json` |',
    '| VS Code Copilot | `.vscode/mcp.json` |',
    '| Codex CLI | `.codex/config.toml` `[mcp_servers.*]` |',
    '',
    '## How to Import',
    '',
    'The `aai:exec` tool accepts three parameters: `app`, `tool`, and `args`.',
    'For this operation, leave `app` empty, set `tool` to `"mcp:import"`, and refer to the examples below for `args`.',
    '',
    '## Examples',
    '',
    'Phase 1 — inspect:',
    '```json',
    JSON.stringify(inspectExample, null, 2),
    '```',
    '',
    'Phase 2 — finalize import:',
    '```json',
    JSON.stringify(finalizeExample, null, 2),
    '```',
    '',
    '## Parameters',
    '',
    '### Local stdio MCP',
    '',
    '| Parameter | Type | Required | Description |',
    '|-----------|------|----------|-------------|',
    '| `command` | string | yes | The executable only, e.g. `"npx"`, `"uvx"`, `"node"` |',
    '| `args` | string[] | no | Arguments after the executable |',
    '| `env` | object | no | Environment variables as `{ "KEY": "value" }` pairs |',
    '| `timeout` | integer | no | Tool execution timeout in ms (default 60000) |',
    '| `cwd` | string | no | Working directory for the process |',
    '| `name` | string | no | Display name for the imported app |',
    '| `summary` | string | phase 2 | Short English description of when to use this MCP |',
    '| `enableScope` | `"current"` \\| `"all"` | phase 2 | Enable for current agent or all agents |',
    '',
    'When converting from a standard MCP JSON config where `command` is an array:',
    '`["npx", "-y", "pkg"]` → `command: "npx"`, `args: ["-y", "pkg"]`',
    '',
    '### Remote MCP',
    '',
    '| Parameter | Type | Required | Description |',
    '|-----------|------|----------|-------------|',
    '| `url` | string | yes | Remote MCP endpoint URL |',
    '| `transport` | string | no | `"streamable-http"` (default) or `"sse"` |',
    '| `headers` | object | no | HTTP headers (e.g. `{ "Authorization": "${API_KEY}" }`). Use `${VAR_NAME}` for secrets. |',
    '| `timeout` | integer | no | Tool execution timeout in ms (default 60000) |',
    '| `name` | string | no | Display name for the imported app |',
    '| `summary` | string | phase 2 | Short English description of when to use this MCP |',
    '| `enableScope` | `"current"` \\| `"all"` | phase 2 | Enable for current agent or all agents |',
    '',
    '## Notes',
    '',
    'Phase 1 omits `summary` and `enableScope`.',
    'Phase 2 repeats the same source config and adds `summary` and `enableScope`.',
    '',
    '## Environment variables & API keys',
    '',
    'Some MCP servers require API keys or other secrets as environment variables.',
    `These are stored in \`${envFile}\`. Use \${VAR_NAME} placeholders in import config (e.g. headers) to reference them.`,
    '',
    'If the import fails due to missing environment variables:',
    `1. Open the env file for the user: run \`open ${envFile}\` via shell.`,
    '2. Tell the user which variables are needed, where to obtain them (e.g. provider dashboard), and the format:',
    '   ```',
    '   VARIABLE_NAME=paste_value_here',
    '   ```',
    '3. After the user confirms the values have been saved, retry `mcp:import` with the same parameters.',
    '',
    '> **CRITICAL**: Never ask the user to send API keys, tokens, or secrets in chat. Never offer to write secrets into files for the user.',
    '> Instead, run `open` via shell to open the env file, tell the user the variable name and format, and let them paste the value themselves.',
  ].join('\n');
}

function extractGuideExamples(
  inputSchema: Record<string, unknown>,
  toolName: string
): Record<string, unknown>[] {
  const rawExamples = inputSchema.examples;
  if (Array.isArray(rawExamples) && rawExamples.length > 0) {
    return rawExamples
      .filter((value): value is Record<string, unknown> => !!value && typeof value === 'object')
      .slice(0, 2);
  }

  if (toolName === 'mcp:import') return [];
  if (toolName === 'listAllAaiApps') return [{}];
  return [];
}
