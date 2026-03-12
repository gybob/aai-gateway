import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { AaiError } from '../../errors/errors.js';
import type { NativeExecutor } from './interface.js';

const execFileAsync = promisify(execFile);

const APPLE_EVENTS_TIMEOUT_MS = 30_000;
const DEFAULT_EVENT_CLASS = 'AAI ';
const DEFAULT_EVENT_ID = 'call';

interface NativeRequest {
  version: '1.0';
  tool: string;
  params: Record<string, unknown>;
  request_id: string;
}

interface NativeResponse {
  version: '1.0';
  request_id: string;
  status: 'success' | 'error';
  result?: unknown;
  error?: { code: string; message: string };
}

export class AppleEventsExecutor implements NativeExecutor {
  async execute(
    appId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const request: NativeRequest = {
      version: '1.0',
      tool: toolName,
      params: args,
      request_id: randomUUID(),
    };

    const jsonStr = JSON.stringify(request).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const eventCode = `${DEFAULT_EVENT_CLASS}${DEFAULT_EVENT_ID}`;
    const script = `tell application id "${appId}"
  «event ${eventCode}» "${jsonStr}"
end tell`;

    let stdout: string;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), APPLE_EVENTS_TIMEOUT_MS);
      try {
        ({ stdout } = await execFileAsync('osascript', ['-e', script], {
          signal: controller.signal,
        }));
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'ABORT_ERR') {
        throw new AaiError('TIMEOUT', `Apple Events call to ${appId}/${toolName} timed out`);
      }
      throw new AaiError(
        'INTERNAL_ERROR',
        `Apple Events call failed for ${appId}/${toolName}: ${String(err)}`
      );
    }

    let response: NativeResponse;
    try {
      response = JSON.parse(stdout.trim()) as NativeResponse;
    } catch {
      throw new AaiError(
        'INTERNAL_ERROR',
        `Invalid JSON response from ${appId}/${toolName}: ${stdout}`
      );
    }

    if (response.status === 'error') {
      const code = response.error?.code ?? 'INTERNAL_ERROR';
      const msg = response.error?.message ?? 'Unknown Apple Events error';
      throw new AaiError('INTERNAL_ERROR', `${appId}/${toolName} error [${code}]: ${msg}`);
    }

    return response.result;
  }
}
