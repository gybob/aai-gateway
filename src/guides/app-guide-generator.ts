import { dirname } from 'node:path';

import { getManagedAppsRoot } from '../storage/paths.js';
import type { AaiJson, DetailedCapability } from '../types/aai-json.js';
import { getLocalizedName, isSkillPathConfig } from '../types/aai-json.js';
import { getSystemLocale } from '../utils/locale.js';

import { generateAcpOperationGuide } from './acp-guide-generator.js';

export function generateAppListDescription(_localId: string, descriptor: AaiJson): string {
  const locale = getSystemLocale();
  const localizedName = getLocalizedName(descriptor.app.name, locale);
  const keywords = descriptor.exposure.keywords.join(', ');
  return `${localizedName}. Guide only; call this tool to inspect how to use the app, then use aai:exec for execution. Keywords: ${keywords}. ${descriptor.exposure.summary}`;
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
  lines.push('Use `aai:exec` with the app ID above.');

  switch (protocol) {
    case 'mcp':
      lines.push('Set `tool` to the MCP tool name and `args` to the tool arguments object.');
      break;
    case 'skill':
      lines.push('Use `tool: "read"` and optionally `args.section` to read the skill content.');
      if (isSkillPathConfig(descriptor.access.config)) {
        lines.push(`Gateway-managed skill base path: ${getManagedAppsRoot()}`);
        lines.push(`Skill directory: ${descriptor.access.config.path}`);
        lines.push(`Skill base path for this app: ${dirname(descriptor.access.config.path)}`);
      }
      break;
    case 'cli':
      lines.push('Use `tool: "run"` or a subcommand name. Pass `args.argv` as a string array and `args.stdin` as optional text.');
      break;
  }

  return lines.join('\n');
}
