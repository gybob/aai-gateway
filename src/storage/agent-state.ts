import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { getAaiHomeDir } from '../utils/config.js';
import { slugify } from '../utils/ids.js';

export interface AgentState {
  agentId: string;
  agentType?: string;
  callerName: string;
  appOverrides: Record<string, 'enabled' | 'disabled'>;
  updatedAt: string;
}

export interface AppPolicyState {
  defaultEnabled: 'all' | 'importer-only';
  importerAgentId?: string;
  updatedAt: string;
}

function getAgentsRoot(): string {
  return join(getAaiHomeDir(), 'agents');
}

function getAgentStatePath(agentId: string): string {
  return join(getAgentsRoot(), `${agentId}.json`);
}

function getAppStatePath(appId: string): string {
  return join(getAaiHomeDir(), 'apps', `${appId}.json`);
}

export function deriveCallerId(input: { callerId?: string; callerName?: string }): string {
  if (input.callerId && input.callerId.trim().length > 0) {
    return slugify(input.callerId);
  }
  if (input.callerName && input.callerName.trim().length > 0) {
    return slugify(input.callerName);
  }
  return 'unknown-client';
}

export async function loadAgentState(agentId: string): Promise<AgentState | null> {
  try {
    const raw = await readFile(getAgentStatePath(agentId), 'utf-8');
    return JSON.parse(raw) as AgentState;
  } catch {
    return null;
  }
}

export async function saveAgentState(state: AgentState): Promise<void> {
  const path = getAgentStatePath(state.agentId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2), 'utf-8');
}

export async function upsertAgentState(input: {
  agentId: string;
  callerName: string;
  agentType?: string;
}): Promise<AgentState> {
  const existing = await loadAgentState(input.agentId);
  const next: AgentState = {
    agentId: input.agentId,
    callerName: input.callerName,
    agentType: input.agentType ?? existing?.agentType,
    appOverrides: existing?.appOverrides ?? {},
    updatedAt: new Date().toISOString(),
  };
  await saveAgentState(next);
  return next;
}

export async function disableAppForAgent(agentId: string, appId: string): Promise<AgentState> {
  const state = (await loadAgentState(agentId)) ?? {
    agentId,
    callerName: agentId,
    appOverrides: {},
    updatedAt: new Date().toISOString(),
  };

  state.appOverrides[appId] = 'disabled';
  state.updatedAt = new Date().toISOString();
  await saveAgentState(state);
  return state;
}

export async function enableAppForAgent(agentId: string, appId: string): Promise<AgentState> {
  const state = await loadAgentState(agentId);
  if (!state) {
    const next: AgentState = {
      agentId,
      callerName: agentId,
      appOverrides: { [appId]: 'enabled' },
      updatedAt: new Date().toISOString(),
    };
    await saveAgentState(next);
    return next;
  }

  state.appOverrides[appId] = 'enabled';
  state.updatedAt = new Date().toISOString();
  await saveAgentState(state);
  return state;
}

export async function loadAppPolicyState(appId: string): Promise<AppPolicyState | null> {
  try {
    const raw = await readFile(getAppStatePath(appId), 'utf-8');
    return JSON.parse(raw) as AppPolicyState;
  } catch {
    return null;
  }
}

export async function saveAppPolicyState(
  appId: string,
  state: AppPolicyState
): Promise<void> {
  const path = getAppStatePath(appId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2), 'utf-8');
}

export async function deleteAppPolicyState(appId: string): Promise<void> {
  await rm(getAppStatePath(appId), { force: true });
}

export async function removeAppFromAllAgents(appId: string): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await readdir(getAgentsRoot());
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;

    const agentId = entry.slice(0, -'.json'.length);
    const state = await loadAgentState(agentId);
    if (!state) continue;

    if (state.appOverrides[appId]) {
      delete state.appOverrides[appId];
      state.updatedAt = new Date().toISOString();
      await saveAgentState(state);
    }
  }
}
