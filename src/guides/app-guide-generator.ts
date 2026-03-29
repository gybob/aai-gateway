import type { AaiJson } from '../types/aai-json.js';
import type { AppCapabilities } from '../types/capabilities.js';
import { getLocalizedName, isSkillAccess, isSkillPathConfig, type InternationalizedName } from '../types/aai-json.js';
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

const TEMPLATE_TOOL_ITEM = `- {{NAME}}: {{DESCRIPTION}}`;

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

// ============================================================================
// Helper Functions
// ============================================================================

function buildToolsSection(capabilities: AppCapabilities): string {
  if (capabilities.tools.length === 0) {
    return 'No tools available.';
  }

  return capabilities.tools
    .map((tool) => {
      const desc = tool.description?.trim();
      const shortDesc = desc ? truncateDescription(desc) : 'No description provided.';
      return renderTemplate(TEMPLATE_TOOL_ITEM, {
        NAME: tool.name,
        DESCRIPTION: shortDesc,
      });
    })
    .join('\n');
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
      return buildAcpExamples(capabilities);

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
    case 'mcp':
      return [
        'Execute via `aai:exec` with the app id above.',
        'If a call fails validation, the error response includes the correct schema.',
      ].join('\n');
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

function buildAcpExamples(capabilities: AppCapabilities): string {
  return capabilities.tools
    .map((tool) => {
      const example = buildAcpExample(tool.name);
      if (!example) {
        return '';
      }
      return renderExampleJson(example);
    })
    .filter(Boolean)
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

function buildAcpExample(toolName: string): Record<string, unknown> | null {
  switch (toolName) {
    case 'session/new':
      return {
        tool: 'session/new',
        args: {
          cwd: '/absolute/path/to/project',
        },
      };
    case 'turn/start':
      return {
        tool: 'turn/start',
        args: {
          sessionId: '<sessionId>',
          prompt: [{ type: 'text', text: 'Summarize the current project.' }],
        },
      };
    case 'turn/poll':
      return {
        tool: 'turn/poll',
        args: {
          turnId: '<turnId>',
        },
      };
    case 'turn/respondPermission':
      return {
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
