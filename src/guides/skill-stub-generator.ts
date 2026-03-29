import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { slugify } from '../utils/ids.js';

export type SkillImportMode = 'manual' | 'auto';

export function generateAppProxySkillMarkdown(input: {
  name: string;
  appId: string;
  summary: string;
  mode: SkillImportMode;
}): string {
  const usageLine =
    input.mode === 'auto'
      ? `Use this skill when the user's request matches this summary: ${input.summary}`
      : `Use this skill only when the user explicitly asks to use ${input.name} through AAI Gateway.`;

  return [
    `# ${input.name} via AAI Gateway`,
    '',
    usageLine,
    '',
    'Do not guess tool names or parameters.',
    'First run:',
    '',
    `\`aai-gateway guide --app ${input.appId}\``,
    '',
    'Then follow the live guide returned by AAI Gateway.',
    '',
  ].join('\n');
}

export async function writeAppProxySkill(input: {
  skillsDir: string;
  name: string;
  appId: string;
  summary: string;
  mode: SkillImportMode;
}): Promise<string> {
  const dirName = `aai-${slugify(input.appId)}`;
  const targetDir = join(input.skillsDir, dirName);
  await mkdir(targetDir, { recursive: true });
  const skillPath = join(targetDir, 'SKILL.md');
  await writeFile(
    skillPath,
    generateAppProxySkillMarkdown(input),
    'utf-8'
  );
  return skillPath;
}
