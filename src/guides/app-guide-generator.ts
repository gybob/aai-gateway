import type { AaiJson, DetailedCapability } from '../types/aai-json.js';
import { getLocalizedName, isSkillAccess, isSkillPathConfig } from '../types/aai-json.js';
import { getSystemLocale } from '../utils/locale.js';

import { generateAcpOperationGuide } from './acp-guide-generator.js';

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
    case 'mcp':
      lines.push('Use `aai:exec` with the app ID above.');
      lines.push('Set `tool` to the MCP tool name and `args` to the tool arguments object.');
      break;
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
