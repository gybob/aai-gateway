import { spawn } from 'node:child_process';
import { logger } from '../utils/logger.js';
import { AaiError } from '../errors/errors.js';
import type { AaiJson, CliExecution } from '../types/aai-json.js';

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class CliExecutor {
  private readonly DEFAULT_TIMEOUT = 120000;
  private readonly DEFAULT_JSON_FLAG = '--json';

  private getCliExecution(descriptor: AaiJson): CliExecution {
    if (descriptor.execution.type !== 'cli') {
      throw new AaiError('INTERNAL_ERROR', 'Descriptor is not a CLI application');
    }
    return descriptor.execution;
  }

  async execute(
    descriptor: AaiJson,
    tool: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const execution = this.getCliExecution(descriptor);
    const jsonFlag = execution.jsonFlag ?? this.DEFAULT_JSON_FLAG;
    const timeout = execution.timeout ?? this.DEFAULT_TIMEOUT;

    const cliArgs = this.buildCliArgs(tool, args, jsonFlag);

    logger.debug({ command: execution.command, tool, args: cliArgs }, 'Executing CLI command');

    const result = await this.runCommand(execution.command, cliArgs, timeout);

    if (result.exitCode !== 0) {
      throw new AaiError(
        'EXECUTION_ERROR',
        `CLI command failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`,
        { exitCode: result.exitCode, stderr: result.stderr }
      );
    }

    try {
      return JSON.parse(result.stdout);
    } catch (err) {
      logger.warn({ stdout: result.stdout, err }, 'Failed to parse CLI output as JSON');
      throw new AaiError('PARSE_ERROR', 'Failed to parse CLI output as JSON', {
        stdout: result.stdout,
        parseError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async getDescriptor(command: string): Promise<AaiJson> {
    const result = await this.runCommand(command, ['--aai'], 10000);

    if (result.exitCode !== 0) {
      throw new AaiError(
        'DESCRIPTOR_ERROR',
        `Failed to get descriptor: ${result.stderr || result.stdout}`,
        { exitCode: result.exitCode }
      );
    }

    try {
      return JSON.parse(result.stdout);
    } catch (err) {
      throw new AaiError('PARSE_ERROR', 'Failed to parse descriptor as JSON', {
        stdout: result.stdout,
      });
    }
  }

  private buildCliArgs(tool: string, args: Record<string, unknown>, jsonFlag: string): string[] {
    const cliArgs: string[] = [jsonFlag, tool];

    for (const [key, value] of Object.entries(args)) {
      if (value === undefined || value === null) continue;

      const kebabKey = this.camelToKebab(key);

      if (typeof value === 'boolean') {
        if (value) {
          cliArgs.push(`--${kebabKey}`);
        }
      } else if (Array.isArray(value)) {
        for (const item of value) {
          cliArgs.push(`--${kebabKey}`, String(item));
        }
      } else {
        cliArgs.push(`--${kebabKey}`, String(value));
      }
    }

    return cliArgs;
  }

  private camelToKebab(str: string): string {
    return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  }

  private runCommand(command: string, args: string[], timeout: number): Promise<CliResult> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        proc.kill();
        reject(new AaiError('TIMEOUT', `CLI command timed out after ${timeout}ms`));
      }, timeout);

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new AaiError('EXECUTION_ERROR', `Failed to execute CLI command: ${err.message}`));
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code ?? 1,
        });
      });
    });
  }
}

let executorInstance: CliExecutor | null = null;

export function getCliExecutor(): CliExecutor {
  if (!executorInstance) {
    executorInstance = new CliExecutor();
  }
  return executorInstance;
}
