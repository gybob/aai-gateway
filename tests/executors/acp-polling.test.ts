import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AcpExecutor } from '../../src/executors/acp.js';

const fixturePath = join(
  fileURLToPath(new URL('../fixtures/mock-acp-agent.mjs', import.meta.url))
);

describe('AcpExecutor polling flow', () => {
  it('returns the first increment from prompt and completes through session/poll', async () => {
    const executor = new AcpExecutor(30);
    const localId = 'acp-polling-normal';
    const config = {
      command: 'node',
      args: [fixturePath],
    };

    try {
      const first = await executor.execute(localId, config, 'prompt', {
        text: 'Normal prompt',
      });

      expect(first.success).toBe(true);
      expect(first.data).toMatchObject({
        done: false,
        status: 'working',
        deltaText: 'Chunk 1.',
        pollTool: 'session/poll',
      });

      const sessionId = (first.data as { sessionId: string }).sessionId;
      const second = await executor.execute(localId, config, 'session/poll', {
        sessionId,
      });

      expect(second.success).toBe(true);
      expect(second.data).toMatchObject({
        sessionId,
        done: true,
        status: 'completed',
        deltaText: 'Chunk 2.',
        outputText: 'Chunk 2.',
      });
    } finally {
      await executor.disconnect(localId);
    }
  });

  it('keeps returning polling instructions until a later poll sees completion', async () => {
    const executor = new AcpExecutor(30);
    const localId = 'acp-polling-timeout';
    const config = {
      command: 'node',
      args: [fixturePath],
    };

    try {
      const first = await executor.execute(localId, config, 'prompt', {
        text: 'NO_UPDATE',
      });

      expect(first.success).toBe(true);
      expect(first.data).toMatchObject({
        done: false,
        status: 'working',
        deltaText: '',
        pollTool: 'session/poll',
      });

      const sessionId = (first.data as { sessionId: string }).sessionId;

      const second = await executor.execute(localId, config, 'session/poll', {
        sessionId,
      });

      expect(second.success).toBe(true);
      expect(second.data).toMatchObject({
        sessionId,
        done: false,
        deltaText: '',
        pollTool: 'session/poll',
      });

      const third = await executor.execute(localId, config, 'session/poll', {
        sessionId,
      });

      expect(third.success).toBe(true);
      expect(third.data).toMatchObject({
        sessionId,
        done: true,
        status: 'completed',
        deltaText: 'Final answer after wait.',
        outputText: 'Final answer after wait.',
      });
    } finally {
      await executor.disconnect(localId);
    }
  });
});
