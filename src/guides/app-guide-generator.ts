import type { AaiJson, DetailedCapability } from '../types/aai-json.js';
import { getLocalizedName, isSkillAccess, isSkillPathConfig } from '../types/aai-json.js';
import { getSystemLocale } from '../utils/locale.js';

import { generateAcpOperationGuide } from './acp-guide-generator.js';

interface McpGuideTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export function generateAppListDescription(_localId: string, descriptor: AaiJson): string {
  const locale = getSystemLocale();
  const localizedName = getLocalizedName(descriptor.app.name, locale);
  const keywords = descriptor.exposure.keywords.join(', ');
  const mustReadGuide =
    'Guide tool only. You must call this tool first before any aai:exec call. Do not guess tool names or arguments.';

  switch (descriptor.access.protocol) {
    case 'mcp':
      return `${localizedName}. ${mustReadGuide} After reading the guide, use aai:exec with the exact MCP tool name and arguments described there. Keywords: ${keywords}. ${descriptor.exposure.summary}`;
    case 'skill':
      return `${localizedName}. ${mustReadGuide} After reading the guide, follow it like a native skill. If the skill only provides instructions, do not call aai:exec. If it refers to files or scripts, read them from the managed skill directory shown in the guide. If it requires an AAI Gateway tool, read that tool's guide first and only then use aai:exec. Keywords: ${keywords}. ${descriptor.exposure.summary}`;
    case 'cli':
      return `${localizedName}. ${mustReadGuide} After reading the guide, use aai:exec with the exact CLI tool and arguments described there. Keywords: ${keywords}. ${descriptor.exposure.summary}`;
    case 'acp-agent':
      return `${localizedName}. ${mustReadGuide} After reading the guide, use aai:exec with the exact ACP tool flow described there. Keywords: ${keywords}. ${descriptor.exposure.summary}`;
  }
}

export function generateOperationGuide(
  localId: string,
  descriptor: AaiJson,
  detail: DetailedCapability
): string {
  const protocol = descriptor.access.protocol;

  if (protocol === 'mcp') {
    return generateMcpOperationGuide(localId, descriptor, detail);
  }

  if (protocol === 'acp-agent') {
    return generateAcpOperationGuide(localId, descriptor, detail);
  }

  const locale = getSystemLocale();
  const localizedName = getLocalizedName(descriptor.app.name, locale);
  const lines: string[] = [];

  lines.push(`# ${localizedName}`);
  lines.push('');
  lines.push(`- App ID: ${localId}`);
  lines.push(`- Protocol: ${protocol}`);
  lines.push(`- Keywords: ${descriptor.exposure.keywords.join(', ')}`);
  lines.push(`- Summary: ${descriptor.exposure.summary}`);
  lines.push('');
  lines.push(`## ${detail.title}`);
  lines.push(detail.body);
  lines.push('');
  lines.push('## Execution');

  switch (protocol) {
    case 'skill':
      lines.push('This AAI Gateway skill is the same as a native skill. The only difference is where the skill files live.');
      if (isSkillAccess(descriptor.access) && isSkillPathConfig(descriptor.access.config)) {
        lines.push(`AAI Gateway managed skill directory: \`${descriptor.access.config.path}\`.`);
      } else {
        lines.push('AAI Gateway managed skill directory: use the local skill path configured for this imported skill.');
      }
      lines.push('If SKILL.md only provides instructions, follow those instructions directly and do not call `aai:exec`.');
      lines.push('If SKILL.md tells you to read a script or file, read it from the AAI Gateway managed skill directory above.');
      lines.push('If SKILL.md tells you to use an AAI Gateway wrapped tool, first call that tool guide (`app:<id>`), then use `aai:exec` with the exact tool name and arguments from that guide.');
      lines.push('Only use `aai:exec` for this skill when SKILL.md explicitly requires it, for example when you need to read this skill through `tool: "read"` and optional `args.section`.');
      break;
    case 'cli':
      lines.push('Use `aai:exec` with the app ID above.');
      lines.push('Use `tool: "run"` or a subcommand name. Pass `args.argv` as a string array and `args.stdin` as optional text.');
      break;
  }

  return lines.join('\n');
}

function generateMcpOperationGuide(
  localId: string,
  descriptor: AaiJson,
  detail: DetailedCapability
): string {
  const locale = getSystemLocale();
  const localizedName = getLocalizedName(descriptor.app.name, locale);
  const lines: string[] = [];
  const tools = parseMcpGuideTools(detail);

  lines.push(`# ${localizedName}`);
  lines.push('');
  lines.push(`- App ID: ${localId}`);
  lines.push('- Protocol: mcp');
  lines.push(`- Keywords: ${descriptor.exposure.keywords.join(', ')}`);
  lines.push(`- Summary: ${descriptor.exposure.summary}`);
  lines.push('');
  lines.push('## MCP Tools');

  if (!tools) {
    lines.push(detail.body);
    lines.push('');
    lines.push('## Execution');
    lines.push('Use `aai:exec` with the app ID above.');
    lines.push('Set `tool` to the MCP tool name and `args` to the tool arguments object.');
    return lines.join('\n');
  }

  if (tools.length === 0) {
    lines.push('No MCP tools reported.');
  } else {
    for (const [index, tool] of tools.entries()) {
      lines.push(`### ${tool.name}`);
      lines.push(tool.description?.trim() || 'No description provided.');
      lines.push('');
      lines.push('Input schema:');
      lines.push(formatJsonCodeBlock(tool.inputSchema ?? { type: 'object', properties: {} }));

      if (index < tools.length - 1) {
        lines.push('');
      }
    }
  }

  lines.push('');
  lines.push('## Execution');
  lines.push('Use `aai:exec` with the app ID above.');
  lines.push('Set `tool` to one of the MCP tool names above.');
  lines.push('Pass `args` that match the selected tool `inputSchema` exactly.');
  lines.push('');
  lines.push('Example:');
  lines.push(formatJsonCodeBlock(buildMcpExecutionExample(localId, tools)));

  return lines.join('\n');
}

function parseMcpGuideTools(detail: DetailedCapability): McpGuideTool[] | null {
  if (detail.title !== 'MCP Tools') {
    return null;
  }

  try {
    const parsed = JSON.parse(detail.body) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed
      .filter((tool): tool is Record<string, unknown> => Boolean(tool) && typeof tool === 'object')
      .map((tool) => ({
        name: typeof tool.name === 'string' ? tool.name : '',
        description: typeof tool.description === 'string' ? tool.description : undefined,
        inputSchema:
          tool.inputSchema && typeof tool.inputSchema === 'object'
            ? (tool.inputSchema as Record<string, unknown>)
            : undefined,
      }))
      .filter((tool) => tool.name.length > 0);
  } catch {
    return null;
  }
}

function buildExampleArgs(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  const example = buildSchemaExample(schema);
  return example && typeof example === 'object' && !Array.isArray(example)
    ? (example as Record<string, unknown>)
    : {};
}

function buildMcpExecutionExample(
  localId: string,
  tools: McpGuideTool[] | null
): Record<string, unknown> {
  const firstTool = tools?.[0];
  return {
    app: localId,
    tool: firstTool?.name ?? '<tool-name>',
    args: buildExampleArgs(firstTool?.inputSchema),
  };
}

function buildSchemaExample(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') {
    return {};
  }

  const record = schema as Record<string, unknown>;

  if (Array.isArray(record.enum) && record.enum.length > 0) {
    return record.enum[0];
  }

  if ('const' in record) {
    return record.const;
  }

  if (Array.isArray(record.anyOf) && record.anyOf.length > 0) {
    return buildSchemaExample(record.anyOf[0]);
  }

  if (Array.isArray(record.oneOf) && record.oneOf.length > 0) {
    return buildSchemaExample(record.oneOf[0]);
  }

  if (Array.isArray(record.allOf) && record.allOf.length > 0) {
    return buildSchemaExample(record.allOf[0]);
  }

  const type = typeof record.type === 'string' ? record.type : undefined;

  if (type === 'string') {
    return '<string>';
  }

  if (type === 'integer' || type === 'number') {
    return 0;
  }

  if (type === 'boolean') {
    return false;
  }

  if (type === 'array') {
    return [buildSchemaExample(record.items)];
  }

  const properties =
    record.properties && typeof record.properties === 'object'
      ? (record.properties as Record<string, unknown>)
      : undefined;

  if (type === 'object' || properties) {
    const result: Record<string, unknown> = {};
    const propertyNames = Object.keys(properties ?? {});
    const required = Array.isArray(record.required)
      ? record.required.filter((name): name is string => typeof name === 'string')
      : [];
    const names = required.length > 0 ? required : propertyNames;

    for (const name of names) {
      result[name] = buildSchemaExample(properties?.[name]);
    }

    return result;
  }

  return '<value>';
}

function formatJsonCodeBlock(value: unknown): string {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n');
}
