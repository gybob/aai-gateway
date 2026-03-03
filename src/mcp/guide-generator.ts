import type { AaiJson, InternationalizedName, LanguageTag } from '../types/aai-json.js';
import { getLocalizedName } from '../types/aai-json.js';
import { getSystemLocale } from '../utils/locale.js';

/**
 * Generate description for tools/list from app info
 */
export function generateAppListDescription(app: {
  appId: string;
  name: InternationalizedName;
  defaultLang: LanguageTag;
  description: string;
  aliases?: string[];
}): string {
  // Collect all names for display
  const allNames = Object.values(app.name).join('|');

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
  const locale = getSystemLocale();

  // Header
  const localizedName = getLocalizedName(descriptor.app.name, locale, descriptor.app.defaultLang);
  sections.push(`# ${localizedName} Operation Guide`);
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
  } else if (descriptor.auth) {
    const auth = descriptor.auth;
    switch (auth.type) {
      case 'apiKey':
        sections.push(`Uses API Key authentication.`);
        if (auth.apiKey.instructions?.short) {
          sections.push(auth.apiKey.instructions.short);
        }
        if (auth.apiKey.obtainUrl) {
          sections.push(`Get your API key: ${auth.apiKey.obtainUrl}`);
        }
        break;
      case 'appCredential':
        sections.push(`Uses App Credential authentication (App ID + App Secret).`);
        if (auth.appCredential.instructions?.short) {
          sections.push(auth.appCredential.instructions.short);
        }
        break;
      case 'oauth2':
        sections.push('Uses OAuth 2.1. First execution opens browser for authorization.');
        break;
      case 'cookie':
        sections.push('Uses Cookie authentication. Requires browser login.');
        if (auth.cookie.loginUrl) {
          sections.push(`Login URL: ${auth.cookie.loginUrl}`);
        }
        break;
      default:
        sections.push('Authentication required.');
    }
  } else {
    sections.push('No authentication required.');
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
