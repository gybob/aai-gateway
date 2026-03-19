import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AaiError } from '../errors/errors.js';
import type { DetailedCapability, SkillConfig } from '../types/aai-json.js';
import { isSkillPathConfig } from '../types/aai-json.js';

export async function loadSkillDetail(config: SkillConfig): Promise<DetailedCapability> {
  const content = await readSkillMarkdown(config);
  return {
    title: 'Skill Details',
    body: content,
  };
}

export async function executeSkill(
  config: SkillConfig,
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  if (toolName !== 'read') {
    throw new AaiError('UNKNOWN_TOOL', `Skill-backed apps only support tool "read", got "${toolName}"`);
  }

  const content = await readSkillMarkdown(config);
  const section = typeof args.section === 'string' ? args.section.trim() : '';
  if (!section) {
    return content;
  }

  const marker = new RegExp(`^#+\\s+${escapeRegExp(section)}\\s*$`, 'im');
  const match = content.match(marker);
  if (!match || match.index === undefined) {
    return content;
  }

  return content.slice(match.index);
}

async function readSkillMarkdown(config: SkillConfig): Promise<string> {
  if (isSkillPathConfig(config)) {
    return readFile(join(config.path, 'SKILL.md'), 'utf-8');
  }

  const response = await fetch(`${config.url.replace(/\/$/, '')}/SKILL.md`);
  if (!response.ok) {
    throw new AaiError(
      'SERVICE_UNAVAILABLE',
      `Failed to fetch remote skill: ${config.url} (${response.status})`
    );
  }
  return response.text();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
