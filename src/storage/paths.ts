import { homedir } from 'node:os';
import { join } from 'node:path';

export function getManagedAppsRoot(): string {
  if (process.env.AAI_GATEWAY_APPS_DIR) {
    return process.env.AAI_GATEWAY_APPS_DIR;
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    return join(localAppData, 'aai-gateway', 'apps');
  }

  return join(homedir(), '.local', 'share', 'aai-gateway', 'apps');
}

export function getManagedAppDir(localId: string): string {
  return join(getManagedAppsRoot(), localId);
}
