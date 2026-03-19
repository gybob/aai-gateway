import { spawn } from 'node:child_process';
import { AaiError } from '../errors/errors.js';
import type {
  CliConfig,
  CliExecutorConfig,
  CliExecutorDetail,
  DetailedCapability,
  ExecutionResult,
} from '../types/index.js';
import type { Executor } from './interface.js';

/**
 * CLI Executor implementation
 *
 * Implements unified Executor interface for CLI-based apps.
 */
export class CliExecutor implements Executor<CliConfig & CliExecutorConfig, CliExecutorDetail> {
  readonly protocol = 'cli';

  async connect(_localId: string, _config: CliConfig & CliExecutorConfig): Promise<void> {
    // CLI apps don't maintain persistent connections
  }

  async disconnect(_localId: string): Promise<void> {
    // CLI apps don't maintain persistent connections
  }

  async loadDetail(config: CliConfig & CliExecutorConfig): Promise<CliExecutorDetail> {
    const result = await runCli(config, ['--help'], undefined, 15000);
    const helpText = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    const availableCommands = this.parseAvailableCommands(helpText);
    return { availableCommands };
  }

  async execute(
    _localId: string,
    config: CliConfig & CliExecutorConfig,
    operation: string,
    args: Record<string, unknown>
  ): Promise<ExecutionResult> {
    try {
      const data = await this.executeCli(config, operation, args);
      return { success: true, data };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async health(_localId: string): Promise<boolean> {
    // CLI apps are always "healthy" as they don't maintain connections
    return true;
  }

  // Legacy methods for backward compatibility

  async loadCliDetail(config: CliConfig & CliExecutorConfig): Promise<DetailedCapability> {
    const result = await runCli(config, ['--help'], undefined, 15000);
    return {
      title: 'CLI Details',
      body: [result.stdout, result.stderr].filter(Boolean).join('\n').trim(),
    };
  }

  async executeCli(
    config: CliConfig & CliExecutorConfig,
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

  private parseAvailableCommands(helpText: string): string[] {
    // Simple heuristic to extract commands from help text
    // This can be improved based on specific CLI formats
    const lines = helpText.split('\n');
    const commands: string[] = [];

    for (const line of lines) {
      // Look for lines that look like commands (e.g., "  command   description")
      const match = line.match(/^\s{2,}(\S+)\s+(.+)/);
      if (match && !match[1].startsWith('-')) {
        commands.push(match[1]);
      }
    }

    return commands;
  }
}

async function runCli(
  config: CliConfig & CliExecutorConfig,
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

let singleton: CliExecutor | undefined;

export function getCliExecutor(): CliExecutor {
  if (!singleton) {
    singleton = new CliExecutor();
  }
  return singleton;
}

// Export legacy functions for backward compatibility
export const legacyLoadCliDetail = (config: CliConfig & CliExecutorConfig) =>
  new CliExecutor().loadCliDetail(config);
export const legacyExecuteCli = (
  config: CliConfig & CliExecutorConfig,
  toolName: string,
  args: Record<string, unknown>
) => new CliExecutor().executeCli(config, toolName, args);
