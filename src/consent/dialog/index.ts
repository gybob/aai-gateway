import { getCurrentPlatform } from "../../utils/platform.js";
import { AaiError } from "../../errors/errors.js";
import { MacOSConsentDialog } from "./macos.js";
import type { ConsentDialog } from "./interface.js";

export type { ConsentDialog, ConsentDialogInfo, ConsentDialogResult } from "./interface.js";

export function createConsentDialog(): ConsentDialog {
  switch (getCurrentPlatform()) {
    case "macos":
      return new MacOSConsentDialog();
    case "linux":
      throw new AaiError("NOT_IMPLEMENTED", "Linux consent dialog not yet supported");
    case "windows":
      throw new AaiError("NOT_IMPLEMENTED", "Windows consent dialog not yet supported");
  }
}
