#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import process from 'node:process';

const AGENTS = [
  { name: 'claude', command: 'claude', args: [] },
  {
    name: 'claude-agent-acp',
    command: 'npx',
    args: ['-y', '@zed-industries/claude-agent-acp'],
  },
  { name: 'codex-app-server', command: 'codex', args: ['app-server', '--listen', 'stdio://'] },
  {
    name: 'codex-acp',
    command: 'npx',
    args: ['-y', '@zed-industries/codex-acp'],
  },
  { name: 'opencode-acp', command: 'opencode', args: ['acp'] },
];

class AcpProbe {
  constructor(command, args) {
    this.command = command;
    this.args = args;
    this.proc = null;
    this.buffer = '';
    this.pending = new Map();
    this.nextId = 1;
    this.notifications = [];
    this.stderr = [];
  }

  async start() {
    this.proc = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env: process.env,
    });

    this.proc.stdout.on('data', (chunk) => this.onStdout(chunk.toString()));
    this.proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      this.stderr.push(text);
    });

    this.proc.on('exit', (code, signal) => {
      const err = new Error(`process exited (code=${code}, signal=${signal})`);
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(err);
      }
      this.pending.clear();
    });
  }

  onStdout(data) {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let msg;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        this.notifications.push({ type: 'non_json_stdout', raw: trimmed });
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(msg, 'id') && !msg.method) {
        const pending = this.pending.get(String(msg.id));
        if (!pending) continue;
        clearTimeout(pending.timer);
        this.pending.delete(String(msg.id));
        if (msg.error) pending.reject(new Error(JSON.stringify(msg.error)));
        else pending.resolve(msg.result);
      } else {
        this.notifications.push(msg);
      }
    }
  }

  call(method, params, timeoutMs = 15000) {
    const id = this.nextId++;
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }) + '\n';

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(String(id), { resolve, reject, timer });
      this.proc.stdin.write(payload);
    });
  }

  async stop() {
    if (!this.proc) return;
    this.proc.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (!this.proc.killed) {
      this.proc.kill('SIGKILL');
    }
  }
}

function extractTextFromNotifications(notifications, sessionId) {
  const chunks = [];
  for (const msg of notifications) {
    if (msg.method !== 'session/update') continue;
    if (msg.params?.sessionId !== sessionId) continue;
    const update = msg.params?.update;
    if (
      update?.sessionUpdate === 'available_commands_update' ||
      update?.sessionUpdate === 'usage_update'
    ) {
      continue;
    }
    for (const fragment of new Set(collectTextFragments(update))) {
      chunks.push(fragment);
    }
  }
  return chunks.join('');
}

function collectTextFragments(value) {
  if (!value) return [];
  if (typeof value === 'string') return value ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => collectTextFragments(item));
  if (typeof value !== 'object') return [];

  if (value.type === 'text' && typeof value.text === 'string') {
    return [value.text];
  }

  return [
    value.content,
    value.contents,
    value.output,
    value.outputs,
    value.delta,
    value.response,
    value.responses,
    value.result,
    value.results,
  ].flatMap((item) => collectTextFragments(item));
}

async function probeAgent(agent) {
  const probe = new AcpProbe(agent.command, agent.args);
  try {
    await probe.start();

    const initialize = await probe.call('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: {
        name: 'acp-probe',
        title: 'ACP Probe',
        version: '0.1.0',
      },
    });

    const session = await probe.call('session/new', {
      cwd: process.cwd(),
      mcpServers: [],
    });

    const sessionId = session?.sessionId;
    if (!sessionId) {
      throw new Error(`session/new did not return sessionId: ${JSON.stringify(session)}`);
    }

    const promptResult = await probe.call(
      'session/prompt',
      {
        sessionId,
        messageId: randomUUID(),
        prompt: [
          {
            type: 'text',
            text: 'Reply with exactly ACP_OK and nothing else.',
          },
        ],
      },
      60000
    );

    const text = extractTextFromNotifications(probe.notifications, sessionId);

    return {
      agent: agent.name,
      ok: true,
      initialize,
      sessionId,
      promptResult,
      text,
      stderr: probe.stderr.join('').trim(),
      notifications: probe.notifications.filter((n) => n.method === 'session/update').length,
    };
  } catch (error) {
    return {
      agent: agent.name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      stderr: probe.stderr.join('').trim(),
      notifications: probe.notifications,
    };
  } finally {
    await probe.stop();
  }
}

async function main() {
  const results = [];
  for (const agent of AGENTS) {
    // keep tests isolated and easy to inspect one by one
    results.push(await probeAgent(agent));
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
