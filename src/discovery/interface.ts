import type { DiscoveredDesktopApp } from "../types/aai-json.js";

export type { DiscoveredDesktopApp };

/** Options for desktop app discovery */
export interface DiscoveryOptions {
  /** Enable scanning of development-stage apps (e.g., Xcode build products) */
  devMode?: boolean;
}

export interface DesktopDiscovery {
  scan(options?: DiscoveryOptions): Promise<DiscoveredDesktopApp[]>;
}
