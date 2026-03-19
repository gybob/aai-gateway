import type { RuntimeAppRecord } from '../types/aai-json.js';

export interface DiscoveryOptions {
  devMode?: boolean;
}

export interface DesktopDiscovery {
  scan(options?: DiscoveryOptions): Promise<RuntimeAppRecord[]>;
}
