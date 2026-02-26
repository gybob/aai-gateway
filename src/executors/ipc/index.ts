import { getCurrentPlatform } from "../../utils/platform.js";
import { AaiError } from "../../errors/errors.js";
import { MacOSIpcExecutor } from "./macos.js";
import type { IpcExecutor } from "./interface.js";

export type { IpcExecutor } from "./interface.js";

export function createIpcExecutor(): IpcExecutor {
  switch (getCurrentPlatform()) {
    case "macos":
      return new MacOSIpcExecutor();
    case "linux":
      throw new AaiError("NOT_IMPLEMENTED", "Linux IPC executor not yet supported");
    case "windows":
      throw new AaiError("NOT_IMPLEMENTED", "Windows IPC executor not yet supported");
  }
}
