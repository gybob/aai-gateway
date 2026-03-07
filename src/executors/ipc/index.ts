import { getCurrentPlatform } from "../../utils/platform.js";
import { MacOSIpcExecutor } from "./macos.js";
import { WindowsIpcExecutor } from "./windows.js";
import { LinuxIpcExecutor } from "./linux.js";
import type { IpcExecutor } from "./interface.js";

export type { IpcExecutor } from "./interface.js";

export function createIpcExecutor(): IpcExecutor {
  switch (getCurrentPlatform()) {
    case "macos":
      return new MacOSIpcExecutor();
    case "linux":
      return new LinuxIpcExecutor();
    case "windows":
      return new WindowsIpcExecutor();
  }
}
