import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { AaiError } from '../errors/errors.js';
import { isSkillPathConfig } from '../types/aai-json.js';
import type {
  DetailedCapability,
  SkillConfig,
  SkillExecutorConfig,
  ExecutionResult,
} from '../types/index.js';
import type { AppCapabilities, ToolSchema } from '../types/capabilities.js';

import type { Executor } from './interface.js';

/**
 * Skill Executor implementation
 *
 * Implements the unified Executor interface for skill-based apps.
 */
export class SkillExecutor implements Executor {
  readonly protocol = 'skill';

  async connect(_appId: string, _config: SkillConfig & SkillExecutorConfig): Promise<void> {
    // Skills don't maintain connections
  }

  async disconnect(_appId: string): Promise<void> {
    // Skills don't maintain connections
  }

  /**
   * Load app-level capabilities for skills
   * Skills have a single "read" tool for reading SKILL.md
   */
  async loadAppCapabilities(
    _appId: string,
    _config: SkillConfig & SkillExecutorConfig
  ): Promise<AppCapabilities> {
    return {
      title: 'Skill',
      tools: [
        {
          name: 'read',
          description: 'Read the skill documentation (SKILL.md)',
        },
      ],
    };
  }

  /**
   * Load schema for a specific skill tool
   * Skills don't have structured schemas, return null
   */
  async loadToolSchema(
    _appId: string,
    _config: SkillConfig & SkillExecutorConfig,
    _toolName: string
  ): Promise<ToolSchema | null> {
    // Skills don't have structured schemas
    return null;
  }


  async execute(
    _appId: string,
    config: SkillConfig & SkillExecutorConfig,
    operation: string,
    args: Record<string, unknown>
  ): Promise<ExecutionResult> {
    try {
      if (operation !== 'read') {
        throw new AaiError(
          'UNKNOWN_TOOL',
          `Skill-backed apps only support tool "read", got "${operation}"`
        );
      }

      const data = await this.readSkill(config, args);
      return { success: true, data };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async health(_appId: string): Promise<boolean> {
    // Skills are always "healthy" as they don't maintain connections
    return true;
  }

  // Legacy methods for backward compatibility

  async loadSkillDetail(config: SkillConfig & SkillExecutorConfig): Promise<DetailedCapability> {
    const content = await readSkillMarkdown(config);
    return {
      title: 'Skill Details',
      body: content,
    };
  }

  async executeSkill(
    config: SkillConfig & SkillExecutorConfig,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const result = await this.execute('', config, toolName, args);
    if (!result.success) {
      throw new AaiError('EXECUTION_ERROR', result.error ?? 'Execution failed');
    }
    return result.data as string;
  }

  private async readSkill(
    config: SkillConfig & SkillExecutorConfig,
    args: Record<string, unknown>
  ): Promise<string> {
    const content = await readSkillMarkdown(config);
    const section = typeof args.section === 'string' ? args.section.trim() : '';
    if (!section) {
      return content;
    }

    const marker = new RegExp(`^#+\\s+${escapeRegExp(section)}\\s*$`, 'im');
    const match = content.match(marker);
    if (match?.index === undefined) {
      return content;
    }

    return content.slice(match.index);
  }
}

async function readSkillMarkdown(config: SkillConfig & SkillExecutorConfig): Promise<string> {
  if (isSkillPathConfig(config)) {
    return readFile(join(config.path, 'SKILL.md'), 'utf-8');
  }

  const response = await fetch(`${config.url.replace(/\/$/, '')}/SKILL.md`);
  if (!response.ok) {
    throw new AaiError(
      'SERVICE_UNAVAILABLE',
      `Failed to fetch remote skill: ${config.url} (${response.status})`
    );
  }
  return response.text();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let singleton: SkillExecutor | undefined;

export function getSkillExecutor(): SkillExecutor {
  if (!singleton) {
    singleton = new SkillExecutor();
  }
  return singleton;
}

// Export legacy functions for backward compatibility
export const legacyLoadSkillDetail = (config: SkillConfig & SkillExecutorConfig) =>
  new SkillExecutor().loadSkillDetail(config);
export const legacyExecuteSkill = (
  config: SkillConfig & SkillExecutorConfig,
  toolName: string,
  args: Record<string, unknown>
) => new SkillExecutor().executeSkill(config, toolName, args);
