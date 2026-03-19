import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacyExecuteSkill as executeSkill, legacyLoadSkillDetail as loadSkillDetail } from './skill.js';

describe('skill executor', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'aai-gateway-skill-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads detail from a local skill directory', async () => {
    await mkdir(tempDir, { recursive: true });
    await writeFile(join(tempDir, 'SKILL.md'), '# Skill\nUse it well.\n', 'utf-8');

    const detail = await loadSkillDetail({ path: tempDir } as any);
    expect(detail.title).toBe('Skill Details');
    expect(detail.body).toContain('Use it well.');
  });

  it('reads the full skill content via executeSkill', async () => {
    await writeFile(join(tempDir, 'SKILL.md'), '# Skill\n## Section\nText\n', 'utf-8');

    const content = await executeSkill({ path: tempDir } as any, 'read', {});
    expect(content).toContain('Section');
  });
});
