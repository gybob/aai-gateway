import type { AaiJson } from '../types/aai-json.js';
import type { AppCapabilities } from '../types/capabilities.js';
import { getLocalizedName, isSkillAccess, isSkillPathConfig } from '../types/aai-json.js';
import { getSystemLocale } from '../utils/locale.js';

// ============================================================================
// Templates
// ============================================================================

const TEMPLATE_APP_LIST_MCP = `{{LOCALIZED_NAME}}. Guide tool only. You must call this tool first before any aai:exec call. Do not guess tool names or arguments. After reading the guide, you must call aai:schema for the specific MCP tool you intend to use, and only then call aai:exec with arguments that match that exact schema. Keywords: {{KEYWORDS}}. {{SUMMARY}}`;

const TEMPLATE_APP_LIST_SKILL = `{{LOCALIZED_NAME}}. Guide tool only. You must call this tool first before any skill:import or mcp:import. Do not guess install sources. Keywords: {{KEYWORDS}}. {{SUMMARY}}`;

const TEMPLATE_APP_LIST_CLI = `{{LOCALIZED_NAME}}. Guide tool only. You must call this tool first before any aai:exec call. Do not guess tool names or arguments. After reading the guide, use aai:exec with the exact CLI tool and arguments described there. Keywords: {{KEYWORDS}}. {{SUMMARY}}`;

const TEMPLATE_APP_LIST_ACP = `Get {{LOCALIZED_NAME}} operation guide`;

const TEMPLATE_APP_GUIDE = `# {{LOCALIZED_NAME}}

- App ID: {{LOCAL_ID}}
- Protocol: {{PROTOCOL}}
- Keywords: {{KEYWORDS}}
- Summary: {{SUMMARY}}

## {{TITLE}}

{{TOOLS}}

## Schema Lookup

Always call \`aai:schema\` with \`{ app: "{{LOCAL_ID}}", tool: "<tool-name>" }\` before \`aai:exec\`. Do not guess tool arguments.

## Execution

{{EXECUTION}}`;

const TEMPLATE_TOOL_ITEM = `### {{NAME}}

{{DESCRIPTION}}
`;

const TEMPLATE_EXEC_MCP = `Use \`aai:exec\` with the app ID above.
Pass \`tool: "<mcp-tool-name>"\` and \`args\` matching the schema from \`aai:schema\`.`;

const TEMPLATE_EXEC_ACP = `Use \`aai:exec\` with the app ID above.
Pass \`tool: "<acp-tool-name>"\` and \`args\` matching the schema from \`aai:schema\`.`;

const TEMPLATE_EXEC_SKILL = `This AAI Gateway skill is the same as a native skill. The only difference is where the skill files live.

{{SKILL_DIR}}

If SKILL.md only provides instructions, follow those instructions directly and do not call \`aai:exec\`.
If SKILL.md tells you to read a script or file, read it from the AAI Gateway managed skill directory above.
If SKILL.md tells you to use an AAI Gateway wrapped tool, first call that tool guide (\`app:<id>\`), then use \`aai:exec\` with the exact tool name and arguments from that guide.
Only use \`aai:exec\` for this skill when SKILL.md explicitly requires it.`;

const TEMPLATE_EXEC_CLI = `Use \`aai:exec\` with the app ID above.
Use \`tool: "run"\` or a subcommand name. Pass \`args.argv\` as a string array and \`args.stdin\` as optional text.`;

// ============================================================================
// Public Functions
// ============================================================================

export function generateAppListDescription(_appId: string, descriptor: AaiJson): string {
  const locale = getSystemLocale();
  const localizedName = getLocalizedName(descriptor.app.name, locale);
  const keywords = descriptor.exposure.keywords.join(', ');

  const params = {
    LOCALIZED_NAME: localizedName,
    KEYWORDS: keywords,
    SUMMARY: descriptor.exposure.summary,
  };

  switch (descriptor.access.protocol) {
    case 'mcp':
      return renderTemplate(TEMPLATE_APP_LIST_MCP, params);
    case 'skill':
      return renderTemplate(TEMPLATE_APP_LIST_SKILL, params);
    case 'cli':
      return renderTemplate(TEMPLATE_APP_LIST_CLI, params);
    case 'acp-agent':
      return renderTemplate(TEMPLATE_APP_LIST_ACP, params);
  }
}

/**
 * Generate app guide using the new AppCapabilities interface
 */
export function generateAppGuide(
  appId: string,
  descriptor: AaiJson,
  capabilities: AppCapabilities
): string {
  const protocol = descriptor.access.protocol;
  const locale = getSystemLocale();
  const localizedName = getLocalizedName(descriptor.app.name, locale);
  const keywords = descriptor.exposure.keywords.join(', ');

  const toolsSection = buildToolsSection(capabilities);
  const executionSection = buildExecutionSection(protocol, descriptor);

  return renderTemplate(TEMPLATE_APP_GUIDE, {
    LOCALIZED_NAME: localizedName,
    LOCAL_ID: appId,
    PROTOCOL: protocol,
    KEYWORDS: keywords,
    SUMMARY: descriptor.exposure.summary,
    TITLE: capabilities.title,
    TOOLS: toolsSection,
    EXECUTION: executionSection,
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

function buildToolsSection(capabilities: AppCapabilities): string {
  if (capabilities.tools.length === 0) {
    return 'No tools available.';
  }

  return capabilities.tools
    .map(
      (tool) =>
        renderTemplate(TEMPLATE_TOOL_ITEM, {
          NAME: tool.name,
          DESCRIPTION: tool.description?.trim() || 'No description provided.',
        }) + '\n'
    )
    .join('');
}

function buildExecutionSection(protocol: string, descriptor: AaiJson): string {
  switch (protocol) {
    case 'mcp':
      return TEMPLATE_EXEC_MCP;

    case 'acp-agent':
      return TEMPLATE_EXEC_ACP;

    case 'skill': {
      const skillDir = buildSkillDirSection(descriptor);
      return renderTemplate(TEMPLATE_EXEC_SKILL, { SKILL_DIR: skillDir });
    }

    case 'cli':
      return TEMPLATE_EXEC_CLI;

    default:
      return 'No specific execution instructions available.';
  }
}

function buildSkillDirSection(descriptor: AaiJson): string {
  if (isSkillAccess(descriptor.access) && isSkillPathConfig(descriptor.access.config)) {
    return `AAI Gateway managed skill directory: \`${descriptor.access.config.path}\`.`;
  }
  return 'AAI Gateway managed skill directory: use the local skill path configured for this imported skill.';
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
