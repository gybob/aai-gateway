import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { AaiJson } from '../types/aai-json.js';
import { getLocalizedName } from '../types/aai-json.js';
import { getSystemLocale } from '../utils/locale.js';
import { logger } from '../utils/logger.js';
import { opencodeDescriptor } from './descriptors/opencode-agent.js';
import { claudeCodeDescriptor } from './descriptors/claude-code-agent.js';
import { geminiCliDescriptor } from './descriptors/gemini-cli-agent.js';

const execAsync = promisify(exec);

/**
 * Discovered Agent
 *
 * An agent that was found installed on the system.
 */
export interface DiscoveredAgent {
  /** Agent ID */
  appId: string;
  /** Localized display name */
  name: string;
  /** Description */
  description: string;
  /** Full descriptor */
  descriptor: AaiJson;
  /** Resolved command path */
  commandPath: string;
}

function getAcpStartCommand(descriptor: AaiJson): string | null {
  if (descriptor.execution.type !== 'acp') return null;
  return descriptor.execution.start.command;
}

/**
 * Built-in agent descriptors
 */
const BUILTIN_AGENTS: AaiJson[] = [opencodeDescriptor, claudeCodeDescriptor, geminiCliDescriptor];

/**
 * Scan for installed ACP agents
 *
 * Checks if known agent commands exist on the system.
 */
export async function scanInstalledAgents(): Promise<DiscoveredAgent[]> {
  const discovered: DiscoveredAgent[] = [];
  const locale = getSystemLocale();

  for (const agent of BUILTIN_AGENTS) {
    const command = getAcpStartCommand(agent);
    if (!command) continue;

    try {
      const commandPath = await checkCommandExists(command);

      if (commandPath) {
        const localizedName = getLocalizedName(agent.app.name, locale, agent.app.defaultLang);

        discovered.push({
          appId: agent.app.id,
          name: localizedName,
          description: agent.app.description,
          descriptor: agent,
          commandPath,
        });

        logger.info({ appId: agent.app.id, command }, 'ACP Agent discovered');
      }
    } catch (err) {
      logger.debug({ appId: agent.app.id }, 'ACP Agent not installed');
    }
  }

  return discovered;
}

/**
 * Check if a command exists on the system
 *
 * @returns Command path if found, null otherwise
 */
async function checkCommandExists(command: string): Promise<string | null> {
  try {
    const checkCmd = process.platform === 'win32' ? `where ${command}` : `which ${command}`;

    const { stdout } = await execAsync(checkCmd);
    return stdout.trim().split('\n')[0] || null;
  } catch {
    return null;
  }
}

/**
 * Look up an agent by alias or name
 */
export function lookupAgentByAlias(input: string): AaiJson | null {
  const normalizedInput = input.toLowerCase();

  for (const descriptor of BUILTIN_AGENTS) {
    // Check aliases
    if (descriptor.app.aliases?.some((a) => a.toLowerCase() === normalizedInput)) {
      return descriptor;
    }
    // Check names
    for (const name of Object.values(descriptor.app.name)) {
      if (name.toLowerCase() === normalizedInput) {
        return descriptor;
      }
    }
  }

  return null;
}

/**
 * Get all built-in agent descriptors
 */
export function getBuiltinAgents(): AaiJson[] {
  return [...BUILTIN_AGENTS];
}
