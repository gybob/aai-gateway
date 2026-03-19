import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { RuntimeAppRecord } from '../types/aai-json.js';
import { logger } from '../utils/logger.js';
import { claudeAcpDescriptor } from './descriptors/claude-code-agent.js';
import { codexAcpDescriptor } from './descriptors/gemini-cli-agent.js';
import { opencodeDescriptor } from './descriptors/opencode-agent.js';

const execAsync = promisify(exec);

interface BuiltinAgent {
  localId: string;
  probeCommand: string;
  descriptor: RuntimeAppRecord['descriptor'];
}

export interface DiscoveredAgent extends RuntimeAppRecord {
  commandPath: string;
}

const BUILTIN_AGENTS: BuiltinAgent[] = [
  {
    localId: 'acp-opencode',
    probeCommand: 'opencode',
    descriptor: opencodeDescriptor,
  },
  {
    localId: 'acp-claude',
    probeCommand: 'claude',
    descriptor: claudeAcpDescriptor,
  },
  {
    localId: 'acp-codex',
    probeCommand: 'codex',
    descriptor: codexAcpDescriptor,
  },
];

export async function scanInstalledAgents(): Promise<DiscoveredAgent[]> {
  const discovered: DiscoveredAgent[] = [];

  for (const candidate of BUILTIN_AGENTS) {
    const commandPath = await checkCommandExists(candidate.probeCommand);
    if (!commandPath) {
      continue;
    }

    discovered.push({
      localId: candidate.localId,
      descriptor: candidate.descriptor,
      source: 'acp-agent',
      commandPath,
      location: commandPath,
    });

    logger.info({ localId: candidate.localId, commandPath }, 'ACP agent discovered');
  }

  return discovered;
}

async function checkCommandExists(command: string): Promise<string | null> {
  try {
    const query = process.platform === 'win32' ? `where ${command}` : `which ${command}`;
    const { stdout } = await execAsync(query);
    return stdout.trim().split('\n')[0] || null;
  } catch {
    return null;
  }
}
