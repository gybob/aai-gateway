import type { AaiJson } from '../types/aai-json.js';
import type { AppCapabilities, ToolSchema } from '../types/capabilities.js';
import {
  getLocalizedName,
  isSkillAccess,
  isSkillPathConfig,
  type InternationalizedName,
} from '../types/aai-json.js';
import { getSystemLocale } from '../utils/locale.js';

// ============================================================================
// Templates
// ============================================================================

const TEMPLATE_GUIDE_TOOL_SUMMARY = `{{LOCALIZED_NAME}}. {{SUMMARY}} Guide tool, no arguments.`;

const TEMPLATE_APP_GUIDE = `# {{LOCALIZED_NAME}}

- App ID: {{LOCAL_ID}}
- Summary: {{SUMMARY}}

## Tools

{{TOOLS}}

{{EXAMPLES_SECTION}}{{NOTES_SECTION}}`;

const TEMPLATE_MCP_APP_GUIDE = `# {{LOCALIZED_NAME}}

This is only an operation guide for tools in this app. To perform the actual operation, you must call \`aai:exec\`.

The \`aai:exec\` tool accepts three parameters: \`app\`, \`tool\`, and \`args\`.
For this app, set \`app\` to "{{LOCAL_ID}}", set \`tool\` to one of the tool names below, and refer to the schema of the selected tool below for \`args\`.

## Tools

{{TOOLS}}`;

const TEMPLATE_ACP_APP_GUIDE = `# {{LOCALIZED_NAME}}

This is only an operation guide for tools in this app. To perform the actual operation, you must call \`aai:exec\`.

The \`aai:exec\` tool accepts three parameters: \`app\`, \`tool\`, and \`args\`.
For this app, set \`app\` to "{{LOCAL_ID}}", set \`tool\` to one of the tool names below, and use each tool's example below as the reference for \`args\`.

## Tools

{{TOOLS}}{{NOTES_SECTION}}`;

const TEMPLATE_TOOL_ITEM = `### {{NAME}}

{{DESCRIPTION}}

{{SCHEMA}}`;

const TEMPLATE_TOOL_ITEM_NO_SCHEMA = `### {{NAME}}

{{DESCRIPTION}}`;

// ============================================================================
// Public Functions
// ============================================================================

export function generateGuideToolSummary(_appId: string, descriptor: AaiJson): string {
  const localizedName = getEnglishName(descriptor.app.name);
  const params = {
    LOCALIZED_NAME: localizedName,
    SUMMARY: normalizeGuideToolSummary(descriptor.exposure.summary),
  };

  switch (descriptor.access.protocol) {
    case 'mcp':
      return renderTemplate(TEMPLATE_GUIDE_TOOL_SUMMARY, params);
    case 'skill':
      return renderTemplate(TEMPLATE_GUIDE_TOOL_SUMMARY, params);
    case 'cli':
      return renderTemplate(TEMPLATE_GUIDE_TOOL_SUMMARY, params);
    case 'acp-agent':
      return renderTemplate(TEMPLATE_GUIDE_TOOL_SUMMARY, params);
  }
}

/**
 * Generate app guide using the new AppCapabilities interface
 */
export function generateAppGuideMarkdown(
  appId: string,
  descriptor: AaiJson,
  capabilities: AppCapabilities
): string {
  const protocol = descriptor.access.protocol;
  if (protocol === 'mcp') {
    return generateMcpAppGuideMarkdown(appId, descriptor, capabilities);
  }
  if (protocol === 'acp-agent') {
    return generateAcpAppGuideMarkdown(appId, descriptor, capabilities);
  }

  const locale = getSystemLocale();
  const localizedName = getLocalizedName(descriptor.app.name, locale);
  const toolsSection = buildToolsSection(capabilities);
  const examplesSection = buildExamplesSection(protocol, capabilities);
  const notesSection = buildNotesSection(protocol, descriptor);

  return renderTemplate(TEMPLATE_APP_GUIDE, {
    LOCALIZED_NAME: localizedName,
    LOCAL_ID: appId,
    SUMMARY: descriptor.exposure.summary,
    TOOLS: toolsSection,
    EXAMPLES_SECTION: examplesSection
      ? `\n## Examples\n\nExecute via \`aai:exec\` with \`app: "${appId}"\`:\n\n${examplesSection}\n`
      : '',
    NOTES_SECTION: notesSection ? `\n## Notes\n\n${notesSection}\n` : '',
  });
}

function generateMcpAppGuideMarkdown(
  appId: string,
  descriptor: AaiJson,
  capabilities: AppCapabilities
): string {
  const locale = getSystemLocale();
  const localizedName = getLocalizedName(descriptor.app.name, locale);
  const toolsSection = buildToolsSection(capabilities);

  return renderTemplate(TEMPLATE_MCP_APP_GUIDE, {
    LOCALIZED_NAME: localizedName,
    LOCAL_ID: appId,
    TOOLS: toolsSection,
  });
}

function generateAcpAppGuideMarkdown(
  appId: string,
  descriptor: AaiJson,
  capabilities: AppCapabilities
): string {
  const locale = getSystemLocale();
  const localizedName = getLocalizedName(descriptor.app.name, locale);
  const toolsSection = buildAcpToolsSection(appId, capabilities);
  const notesSection = buildNotesSection('acp-agent', descriptor);

  return renderTemplate(TEMPLATE_ACP_APP_GUIDE, {
    LOCALIZED_NAME: localizedName,
    LOCAL_ID: appId,
    TOOLS: toolsSection,
    NOTES_SECTION: notesSection ? `\n\n## Notes\n\n${notesSection}\n` : '',
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

function buildToolsSection(
  capabilities: AppCapabilities,
  options: { includeSchema?: boolean } = {}
): string {
  if (capabilities.tools.length === 0) {
    return 'No tools available.';
  }

  const includeSchema = options.includeSchema ?? true;
  return capabilities.tools
    .map((tool) => {
      const desc = tool.description?.trim();
      const shortDesc = desc ? truncateDescription(desc) : 'No description provided.';
      return renderTemplate(includeSchema ? TEMPLATE_TOOL_ITEM : TEMPLATE_TOOL_ITEM_NO_SCHEMA, {
        NAME: tool.name,
        DESCRIPTION: shortDesc,
        SCHEMA: includeSchema ? formatToolSchema(tool) : '',
      });
    })
    .join('\n');
}

function formatToolSchema(tool: ToolSchema): string {
  const schema: Record<string, unknown> = { inputSchema: tool.inputSchema };
  if (tool.outputSchema) {
    schema.outputSchema = tool.outputSchema;
  }
  return ['```json', JSON.stringify(schema, null, 2), '```'].join('\n');
}

function truncateDescription(desc: string): string {
  const firstSentence = desc.split(/(?<=[.!?])\s/)[0];
  return firstSentence.length <= 120 ? firstSentence : `${firstSentence.slice(0, 117)}...`;
}

function buildExamplesSection(protocol: string, capabilities: AppCapabilities): string {
  switch (protocol) {
    case 'mcp':
      return '';

    case 'acp-agent':
      return '';

    case 'skill':
      return buildSkillExamples(capabilities);

    case 'cli':
      return buildCliExamples(capabilities);

    default:
      return '';
  }
}

function buildNotesSection(protocol: string, descriptor: AaiJson): string {
  switch (protocol) {
    case 'acp-agent':
      return 'session/new returns promptCapabilities. turn/start.prompt must match those capabilities.';
    case 'skill':
      return [
        'Execute via `aai:exec` with the app id above.',
        buildSkillDirSection(descriptor),
      ].join('\n');
    case 'cli':
      return 'Pass args.argv as a string array and args.stdin as optional text.';
    default:
      return '';
  }
}

function buildSkillDirSection(descriptor: AaiJson): string {
  if (isSkillAccess(descriptor.access) && isSkillPathConfig(descriptor.access.config)) {
    return `AAI Gateway managed skill directory: \`${descriptor.access.config.path}\`.`;
  }
  return 'AAI Gateway managed skill directory: use the local skill path configured for this imported skill.';
}

function buildAcpToolsSection(appId: string, capabilities: AppCapabilities): string {
  if (capabilities.tools.length === 0) {
    return 'No tools available.';
  }

  return capabilities.tools
    .map((tool) => {
      const desc = tool.description?.trim();
      const shortDesc = desc ? truncateDescription(desc) : 'No description provided.';
      const example = buildAcpExample(tool.name, appId);

      return [
        `### ${tool.name}`,
        '',
        shortDesc,
        '',
        'args：',
        '',
        example ? JSON.stringify(example, null, 2) : 'No example available.',
      ].join('\n');
    })
    .join('\n\n');
}

function buildSkillExamples(capabilities: AppCapabilities): string {
  if (!capabilities.tools.some((tool) => tool.name === 'read')) {
    return '';
  }

  return renderExampleJson({
    tool: 'read',
    args: {},
  });
}

function buildCliExamples(capabilities: AppCapabilities): string {
  const primaryTool = capabilities.tools.find((tool) => tool.name === 'run')?.name ?? 'run';
  return renderExampleJson({
    tool: primaryTool,
    args: {
      argv: ['--help'],
    },
  });
}

function buildAcpExample(toolName: string, appId: string): Record<string, unknown> | null {
  switch (toolName) {
    case 'session/new':
      return {
        app: appId,
        tool: 'session/new',
        args: {
          cwd: '/absolute/path/to/project',
        },
      };
    case 'turn/start':
      return {
        app: appId,
        tool: 'turn/start',
        args: {
          sessionId: '<sessionId>',
          prompt: [{ type: 'text', text: 'Summarize the current project.' }],
        },
      };
    case 'turn/poll':
      return {
        app: appId,
        tool: 'turn/poll',
        args: {
          turnId: '<turnId>',
        },
      };
    case 'turn/respondPermission':
      return {
        app: appId,
        tool: 'turn/respondPermission',
        args: {
          turnId: '<turnId>',
          permissionId: '<permissionId>',
          decision: {
            type: 'select',
            optionId: '<optionId>',
          },
        },
      };
    case 'turn/cancel':
      return {
        app: appId,
        tool: 'turn/cancel',
        args: {
          turnId: '<turnId>',
        },
      };
    default:
      return null;
  }
}

function renderExampleJson(payload: Record<string, unknown>): string {
  return ['```json', JSON.stringify(payload, null, 2), '```'].join('\n');
}

function normalizeGuideToolSummary(summary: string): string {
  return summary.trim().replace(/\s+/g, ' ');
}

function getEnglishName(name: InternationalizedName): string {
  return name.en ?? name['en-US'] ?? name.default;
}

// ============================================================================
// Simple Template Engine
// ============================================================================

interface TemplateVars {
  [key: string]: string | number | boolean | undefined;
}

/**
 * Simple template renderer supporting {{variable}} and {{#if}}...{{/if}} blocks.
 */
function renderTemplate(template: string, vars: TemplateVars): string {
  let output = template;

  // Handle if blocks: {{#if VAR}}...{{/if}}
  output = output.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, varName, content) => {
    const value = vars[varName];
    if (value && value !== 'false' && value !== '0') {
      return content;
    }
    return '';
  });

  // Handle variable replacement
  output = output.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
    const value = vars[varName];
    return value !== undefined ? String(value) : '';
  });

  return output;
}
