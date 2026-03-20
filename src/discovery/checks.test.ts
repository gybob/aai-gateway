import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { evaluateDescriptorAvailability } from './checks.js';

describe('discovery checks', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'aai-gateway-checks-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('passes command checks when the command exists', async () => {
    const result = await evaluateDescriptorAvailability({
      schemaVersion: '2.0',
      version: '1.0.0',
      app: { name: { default: 'Node' } },
      discovery: {
        checks: [{ kind: 'command', command: 'node' }],
      },
      access: {
        protocol: 'cli',
        config: { command: 'node' },
      },
      exposure: {
        keywords: ['node'],
        summary: 'Node CLI.',
      },
    });

    expect(result.available).toBe(true);
    expect(result.location).toBeTruthy();
  });

  it('passes file checks when the file exists', async () => {
    const filePath = join(tempDir, 'aai.json');
    await writeFile(filePath, '{}', 'utf-8');

    const result = await evaluateDescriptorAvailability({
      schemaVersion: '2.0',
      version: '1.0.0',
      app: { name: { default: 'File App' } },
      discovery: {
        checks: [{ kind: 'file', path: filePath }],
      },
      access: {
        protocol: 'cli',
        config: { command: 'node' },
      },
      exposure: {
        keywords: ['file'],
        summary: 'File app.',
      },
    });

    expect(result).toEqual({
      available: true,
      location: filePath,
    });
  });

  it('passes path checks when the directory exists', async () => {
    const dirPath = join(tempDir, 'skill');
    await mkdir(dirPath, { recursive: true });

    const result = await evaluateDescriptorAvailability({
      schemaVersion: '2.0',
      version: '1.0.0',
      app: { name: { default: 'Skill' } },
      discovery: {
        checks: [{ kind: 'path', path: dirPath }],
      },
      access: {
        protocol: 'skill',
        config: { path: dirPath },
      },
      exposure: {
        keywords: ['skill'],
        summary: 'Skill.',
      },
    });

    expect(result).toEqual({
      available: true,
      location: dirPath,
    });
  });

  it('fails when any required check is missing', async () => {
    const result = await evaluateDescriptorAvailability({
      schemaVersion: '2.0',
      version: '1.0.0',
      app: { name: { default: 'Missing' } },
      discovery: {
        checks: [
          { kind: 'command', command: 'node' },
          { kind: 'file', path: join(tempDir, 'missing.json') },
        ],
      },
      access: {
        protocol: 'cli',
        config: { command: 'node' },
      },
      exposure: {
        keywords: ['missing'],
        summary: 'Missing.',
      },
    });

    expect(result).toEqual({
      available: false,
      location: null,
    });
  });
});
