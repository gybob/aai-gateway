import type { AaiJson } from '../types/aai-json.js';

/**
 * Parse multi-language name string (pipe-separated)
 */
export function parseMultiLanguageName(name: string): string[] {
  return name.split('|').map((n) => n.trim());
}

/**
 * Generate description for tools/list from app info
 */
export function generateAppListDescription(app: {
  appId: string;
  name: string;
  description: string;
  aliases?: string[];
}): string {
  const names = parseMultiLanguageName(app.name);
  const allNames = names.join('|');
  
  const aliases = app.aliases ?? [];
  const aliasStr = aliases.length > 0 ? ` Aliases: ${aliases.join(', ')}.` : '';
  
  return `【${allNames}】${app.description}.${aliasStr} Call to get guide.`;
}

/**
 * Generate operation guide for an app
 */
export function generateOperationGuide(
  appId: string,
  descriptor: AaiJson,
  platform: 'desktop' | 'web'
): string {
  const sections: string[] = [];

  // Header
  const names = parseMultiLanguageName(descriptor.app.name);
  sections.push(`# ${names[0]} Operation Guide`);
  sections.push('');

  // App Info
  sections.push('## App Info');
  sections.push(`- ID: ${appId}`);
  sections.push(`- Platform: ${descriptor.platform}`);
  sections.push('');

  // Authentication
  sections.push('## Authentication');
  if (platform === 'desktop') {
    sections.push('Uses OS-level consent (TCC). First execution shows native dialog.');
  } else {
    sections.push('Uses OAuth 2.1. First execution opens browser for authorization.');
  }
  sections.push('');

  // Available Operations
  sections.push('## Available Operations');
  sections.push('');

  for (const tool of descriptor.tools) {
    sections.push(`### ${tool.name}`);
    sections.push(tool.description);
    sections.push('');

    // Parameters
    const params = tool.parameters as {
      properties?: Record<string, { description?: string; type?: string }>;
      required?: string[];
    };
    if (params?.properties && Object.keys(params.properties).length > 0) {
      sections.push('**Parameters**:');
      for (const [key, value] of Object.entries(params.properties)) {
        const required = params.required?.includes(key) ? 'required' : 'optional';
        const desc = value.description ?? '';
        sections.push(`- ${key} (${value.type ?? 'any'}, ${required}): ${desc}`);
      }
      sections.push('');
    }

    // Example
    sections.push('**Example**:');
    sections.push('```');
    sections.push(`aai:exec({`);
    sections.push(`  app: "${appId}",`);
    sections.push(`  tool: "${tool.name}",`);
    sections.push(`  args: { ... }`);
    sections.push(`})`);
    sections.push('```');
    sections.push('');
  }

  // Footer
  sections.push('---');
  sections.push('Use aai:exec tool to execute operations.');

  return sections.join('\n');
}
