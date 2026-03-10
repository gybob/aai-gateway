import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getLocalizedName } from '../types/aai-json.js';
import { getSystemLocale } from '../utils/locale.js';
import { logger } from '../utils/logger.js';
import { opencodeDescriptor } from './descriptors/agents/opencode.js';
import { claudeCodeDescriptor } from './descriptors/agents/claude-code.js';
import { geminiCliDescriptor } from './descriptors/agents/gemini-cli.js';

const execAsync = promisify(exec);

/**
 * Agent Descriptor
 *
 * Describes an ACP-compatible agent that can be discovered and executed.
 */
export interface AgentDescriptor {
  /** Unique agent identifier (e.g., 'dev.sst.opencode') */
  id: string;
  /** Localized display names */
  name: Record<string, string>;
  /** Default language for fallback */
  defaultLang: string;
  /** Brief description */
  description: string;
  /** Alternative names for lookup */
  aliases?: string[];
  /** Process start configuration */
  start: {
    /** Command to execute (e.g., 'opencode') */
    command: string;
    /** Command arguments */
    args?: string[];
    /** Environment variables */
    env?: Record<string, string>;
  };
  /** Available tools (ACP methods) */
  tools: Array<{
    /** ACP method name (e.g., 'session/new') */
    name: string;
    /** Tool description */
    description: string;
    /** JSON Schema parameters */
    parameters: object;
  }>;
}

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
  descriptor: AgentDescriptor;
  /** Resolved command path */
  commandPath: string;
}

/**
 * Built-in agent descriptors
 */
const BUILTIN_AGENTS: AgentDescriptor[] = [
  opencodeDescriptor,
  claudeCodeDescriptor,
  geminiCliDescriptor,
];

/**
 * Scan for installed ACP agents
 *
 * Checks if known agent commands exist on the system.
 */
export async function scanInstalledAgents(): Promise<DiscoveredAgent[]> {
  const discovered: DiscoveredAgent[] = [];
  const locale = getSystemLocale();

  for (const agent of BUILTIN_AGENTS) {
    try {
      const commandPath = await checkCommandExists(agent.start.command);

      if (commandPath) {
        const localizedName = getLocalizedName(agent.name, locale, agent.defaultLang);

        discovered.push({
          appId: agent.id,
          name: localizedName,
          description: agent.description,
          descriptor: agent,
          commandPath,
        });

        logger.info({ appId: agent.id, command: agent.start.command }, 'ACP Agent discovered');
      }
    } catch (err) {
      logger.debug({ appId: agent.id }, 'ACP Agent not installed');
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
export function lookupAgentByAlias(input: string): AgentDescriptor | null {
  const normalizedInput = input.toLowerCase();

  for (const descriptor of BUILTIN_AGENTS) {
    // Check aliases
    if (descriptor.aliases?.some((a) => a.toLowerCase() === normalizedInput)) {
      return descriptor;
    }
    // Check names
    for (const name of Object.values(descriptor.name)) {
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
export function getBuiltinAgents(): AgentDescriptor[] {
  return [...BUILTIN_AGENTS];
}
