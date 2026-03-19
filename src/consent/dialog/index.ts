import { getCurrentPlatform } from "../../utils/platform.js";

import type { ConsentDialog } from "./interface.js";
import { LinuxConsentDialog } from "./linux.js";
import { MacOSConsentDialog } from "./macos.js";
import { WindowsConsentDialog } from "./windows.js";

export type { ConsentDialog, ConsentDialogInfo, ConsentDialogResult } from "./interface.js";

export function createConsentDialog(): ConsentDialog {
  switch (getCurrentPlatform()) {
    case "macos":
      return new MacOSConsentDialog();
    case "linux":
      return new LinuxConsentDialog();
    case "windows":
      return new WindowsConsentDialog();
  }
}
