import { getCurrentPlatform } from "../utils/platform.js";
import { AaiError } from "../errors/errors.js";
import { MacOSDiscovery } from "./macos.js";
import type { DesktopDiscovery } from "./interface.js";

export type { DesktopDiscovery, DiscoveredDesktopApp } from "./interface.js";

export function createDesktopDiscovery(): DesktopDiscovery {
  switch (getCurrentPlatform()) {
    case "macos":
      return new MacOSDiscovery();
    case "linux":
      throw new AaiError("NOT_IMPLEMENTED", "Linux desktop discovery not yet supported");
    case "windows":
      throw new AaiError("NOT_IMPLEMENTED", "Windows desktop discovery not yet supported");
  }
}
