import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { getAaiHomeDir } from '../utils/config.js';
import { slugify } from '../utils/ids.js';

export interface AgentState {
  agentId: string;
  agentType?: string;
  callerName: string;
  skillDir?: string;
  disabledApps: string[];
  generatedStubs: Record<string, string>;
  updatedAt: string;
}

export interface AppVisibilityState {
  mode: 'all' | 'current-agent';
  ownerAgentId?: string;
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
  skillDir?: string;
}): Promise<AgentState> {
  const existing = await loadAgentState(input.agentId);
  const next: AgentState = {
    agentId: input.agentId,
    callerName: input.callerName,
    agentType: input.agentType ?? existing?.agentType,
    skillDir: input.skillDir ?? existing?.skillDir,
    disabledApps: existing?.disabledApps ?? [],
    generatedStubs: existing?.generatedStubs ?? {},
    updatedAt: new Date().toISOString(),
  };
  await saveAgentState(next);
  return next;
}

export async function listDisabledAppsForAgent(agentId: string): Promise<string[]> {
  const state = await loadAgentState(agentId);
  return state?.disabledApps ?? [];
}

export async function disableAppForAgent(agentId: string, appId: string): Promise<AgentState> {
  const state = (await loadAgentState(agentId)) ?? {
    agentId,
    callerName: agentId,
    disabledApps: [],
    generatedStubs: {},
    updatedAt: new Date().toISOString(),
  };

  if (!state.disabledApps.includes(appId)) {
    state.disabledApps.push(appId);
  }

  const stubPath = state.generatedStubs[appId];
  if (stubPath) {
    await rm(dirname(stubPath), { recursive: true, force: true });
    delete state.generatedStubs[appId];
  }

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
      disabledApps: [],
      generatedStubs: {},
      updatedAt: new Date().toISOString(),
    };
    await saveAgentState(next);
    return next;
  }

  state.disabledApps = state.disabledApps.filter((item) => item !== appId);
  state.updatedAt = new Date().toISOString();
  await saveAgentState(state);
  return state;
}

export async function loadAppVisibilityState(appId: string): Promise<AppVisibilityState | null> {
  try {
    const raw = await readFile(getAppStatePath(appId), 'utf-8');
    return JSON.parse(raw) as AppVisibilityState;
  } catch {
    return null;
  }
}

export async function saveAppVisibilityState(
  appId: string,
  state: AppVisibilityState
): Promise<void> {
  const path = getAppStatePath(appId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2), 'utf-8');
}

export async function deleteAppVisibilityState(appId: string): Promise<void> {
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
    if (!entry.endsWith('.json')) {
      continue;
    }

    const agentId = entry.slice(0, -'.json'.length);
    const state = await loadAgentState(agentId);
    if (!state) {
      continue;
    }

    let changed = false;
    const nextDisabledApps = state.disabledApps.filter((item) => item !== appId);
    if (nextDisabledApps.length !== state.disabledApps.length) {
      state.disabledApps = nextDisabledApps;
      changed = true;
    }

    const stubPath = state.generatedStubs[appId];
    if (stubPath) {
      await rm(dirname(stubPath), { recursive: true, force: true });
      delete state.generatedStubs[appId];
      changed = true;
    }

    if (changed) {
      state.updatedAt = new Date().toISOString();
      await saveAgentState(state);
    }
  }
}
