import { getCurrentPlatform } from "../../utils/platform.js";

import type { SecureStorage } from "./interface.js";
import { LinuxSecureStorage } from "./linux.js";
import { MacOSKeychain } from "./macos.js";
import { WindowsSecureStorage } from "./windows.js";

export type { SecureStorage } from "./interface.js";

export function createSecureStorage(): SecureStorage {
  switch (getCurrentPlatform()) {
    case "macos":
      return new MacOSKeychain();
    case "linux":
      return new LinuxSecureStorage();
    case "windows":
      return new WindowsSecureStorage();
  }
}
