import { describe, expect, it } from 'vitest';
import { loadCliDetail, executeCli } from './cli.js';

describe('cli executor', () => {
  it('loads CLI help output', async () => {
    const detail = await loadCliDetail({
      command: process.execPath,
    });

    expect(detail.title).toBe('CLI Details');
    expect(detail.body.length).toBeGreaterThan(0);
  });

  it('executes a command with argv passthrough', async () => {
    const result = await executeCli(
      {
        command: process.execPath,
        args: ['-e', 'process.stdout.write(process.argv.slice(1).join(","))'],
      },
      'run',
      { argv: ['alpha', 'beta'] }
    );

    expect(result).toContain('alpha,beta');
  });
});
