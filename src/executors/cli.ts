import { spawn } from 'node:child_process';
import { AaiError } from '../errors/errors.js';
import type { CliConfig, DetailedCapability } from '../types/aai-json.js';

export async function loadCliDetail(config: CliConfig): Promise<DetailedCapability> {
  const result = await runCli(config, ['--help'], undefined, 15000);
  return {
    title: 'CLI Details',
    body: [result.stdout, result.stderr].filter(Boolean).join('\n').trim(),
  };
}

export async function executeCli(
  config: CliConfig,
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  const argv = Array.isArray(args.argv) ? args.argv.map(String) : [];
  const stdin = typeof args.stdin === 'string' ? args.stdin : undefined;
  const commandArgs = [...(config.args ?? [])];

  if (toolName && toolName !== 'run') {
    commandArgs.push(toolName);
  }
  commandArgs.push(...argv);

  const result = await runCli({ ...config, args: commandArgs }, [], stdin, 120000);
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  return output || '(no output)';
}

async function runCli(
  config: CliConfig,
  extraArgs: string[],
  stdin: string | undefined,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.command, [...(config.args ?? []), ...extraArgs], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: config.cwd,
      env: { ...process.env, ...config.env },
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new AaiError('TIMEOUT', `CLI command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new AaiError('SERVICE_UNAVAILABLE', `Failed to start CLI command: ${err.message}`));
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code && code !== 0) {
        reject(new AaiError('EXECUTION_ERROR', stderr.trim() || `CLI exited with ${code}`));
        return;
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
    });

    if (stdin) {
      proc.stdin?.write(stdin);
    }
    proc.stdin?.end();
  });
}
