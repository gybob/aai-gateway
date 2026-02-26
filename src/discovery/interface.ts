import type { DiscoveredDesktopApp } from "../types/aai-json.js";

export type { DiscoveredDesktopApp };

export interface DesktopDiscovery {
  scan(): Promise<DiscoveredDesktopApp[]>;
}
