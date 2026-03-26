import { spawn } from 'node:child_process';

import { AaiError } from '../errors/errors.js';
import type {
  CliConfig,
  CliExecutorConfig,
  DetailedCapability,
  ExecutionResult,
} from '../types/index.js';
import type { AppCapabilities, ToolSchema } from '../types/capabilities.js';

import type { Executor } from './interface.js';

/**
 * CLI Executor implementation
 *
 * Implements unified Executor interface for CLI-based apps.
 */
export class CliExecutor implements Executor {
  readonly protocol = 'cli';

  async connect(_appId: string, _config: CliConfig & CliExecutorConfig): Promise<void> {
    // CLI apps don't maintain persistent connections
  }

  async disconnect(_appId: string): Promise<void> {
    // CLI apps don't maintain persistent connections
  }

  /**
   * Load app-level capabilities for CLI apps
   * Returns available commands from --help output
   */
  async loadAppCapabilities(
    _appId: string,
    config: CliConfig & CliExecutorConfig
  ): Promise<AppCapabilities> {
    try {
      const result = await runCli(config, ['--help'], undefined, 15000);
      const helpText = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
      const commands = this.parseAvailableCommands(helpText);

      return {
        title: 'CLI Commands',
        tools: commands.map((cmd) => ({
          name: cmd,
          description: 'CLI command',
        })),
      };
    } catch {
      return { title: 'CLI', tools: [] };
    }
  }

  /**
   * Load schema for a specific CLI command
   * CLI apps don't have structured schemas, return null
   */
  async loadToolSchema(
    _appId: string,
    _config: CliConfig & CliExecutorConfig,
    _toolName: string
  ): Promise<ToolSchema | null> {
    // CLI apps don't have structured schemas
    return null;
  }


  async execute(
    _appId: string,
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

  async health(_appId: string): Promise<boolean> {
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
