import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ConsentDialog, ConsentDialogInfo, ConsentDialogResult } from "./interface.js";

const execFileAsync = promisify(execFile);

function buildParamLines(parameters: object): string {
  const props = (parameters as { properties?: Record<string, { description?: string }> }).properties ?? {};
  return Object.entries(props)
    .map(([k, v]) => `• ${k}${v.description ? `: ${v.description}` : ""}`)
    .join("\\n") || "(no parameters)";
}

export class MacOSConsentDialog implements ConsentDialog {
  async show(info: ConsentDialogInfo): Promise<ConsentDialogResult> {
    const paramLines = buildParamLines(info.parameters);

    const authScript = `
set dialogText to "⚠️ Tool Authorization Request

App: ${info.appName} (${info.appId})

Agent requests permission to use:

${info.toolName}
${info.toolDescription}

Parameters:
${paramLines}"
set result to display dialog dialogText buttons {"Deny", "Authorize Tool", "Authorize All"} default button "Authorize Tool" with icon caution
set btn to button returned of result
return btn
`.trim();

    let decision: "tool" | "all" | "deny";
    try {
      const { stdout } = await execFileAsync("osascript", ["-e", authScript]);
      const btn = stdout.trim();
      if (btn === "Authorize All") {
        decision = "all";
      } else if (btn === "Authorize Tool") {
        decision = "tool";
      } else {
        decision = "deny";
      }
    } catch {
      // user clicked Deny or closed dialog
      decision = "deny";
    }

    if (decision === "deny") {
      return { decision: "deny", remember: false };
    }

    // Ask if user wants to remember the decision
    let remember = false;
    try {
      const rememberScript = `
set r to display dialog "Remember this decision for '${info.toolName}'?" buttons {"No", "Yes"} default button "Yes"
return button returned of r
`.trim();
      const { stdout: remOut } = await execFileAsync("osascript", ["-e", rememberScript]);
      remember = remOut.trim() === "Yes";
    } catch {
      remember = false;
    }

    return { decision, remember };
  }
}
