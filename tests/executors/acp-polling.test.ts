import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AcpExecutor } from '../../src/executors/acp.js';

const fixturePath = join(
  fileURLToPath(new URL('../fixtures/mock-acp-agent.mjs', import.meta.url))
);

describe('AcpExecutor polling flow', () => {
  it('returns turn-scoped increments and completes through turn/poll', async () => {
    const executor = new AcpExecutor(15);
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
        pollTool: 'turn/poll',
      });

      const { sessionId, turnId, cursor } = first.data as {
        sessionId: string;
        turnId: string;
        cursor: number;
      };
      const second = await executor.execute(localId, config, 'turn/poll', {
        turnId,
        cursor,
      });

      expect(second.success).toBe(true);
      expect(second.data).toMatchObject({
        turnId,
        sessionId,
        cursor: 2,
        done: true,
        status: 'completed',
        deltaText: 'Chunk 2.',
        outputText: 'Chunk 2.',
      });
    } finally {
      await executor.disconnect(localId);
    }
  });

  it('waits a full polling window while unfinished and completes on a later turn/poll', async () => {
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
        pollTool: 'turn/poll',
      });

      const { sessionId, turnId, cursor } = first.data as {
        sessionId: string;
        turnId: string;
        cursor: number;
      };

      const second = await executor.execute(localId, config, 'turn/poll', {
        turnId,
        cursor,
      });

      expect(second.success).toBe(true);
      expect(second.data).toMatchObject({
        turnId,
        sessionId,
        cursor,
        done: false,
        deltaText: '',
        pollTool: 'turn/poll',
      });

      const third = await executor.execute(localId, config, 'turn/poll', {
        turnId,
        cursor,
      });

      expect(third.success).toBe(true);
      expect(third.data).toMatchObject({
        turnId,
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
