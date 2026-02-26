import { getCurrentPlatform } from "../../utils/platform.js";
import { AaiError } from "../../errors/errors.js";
import { MacOSKeychain } from "./macos.js";
import type { SecureStorage } from "./interface.js";

export type { SecureStorage } from "./interface.js";

export function createSecureStorage(): SecureStorage {
  switch (getCurrentPlatform()) {
    case "macos":
      return new MacOSKeychain();
    case "linux":
      throw new AaiError("NOT_IMPLEMENTED", "Linux secure storage not yet supported");
    case "windows":
      throw new AaiError("NOT_IMPLEMENTED", "Windows secure storage not yet supported");
  }
}
