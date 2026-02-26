import { AaiError, type ConsentRequiredData } from "../errors/errors.js";
import type { SecureStorage } from "../storage/secure-storage/interface.js";
import type { ConsentDialog } from "./dialog/interface.js";

interface ToolConsentRecord {
  granted: boolean;
  granted_at: string;
  remember: boolean;
}

interface AppConsentRecord {
  all_tools: boolean;
  tools: Record<string, ToolConsentRecord>;
}

export interface ConsentToolInfo {
  name: string;
  description: string;
  parameters: object;
}

function accountKey(appId: string): string {
  return `consent-${appId}`;
}

export class ConsentManager {
  constructor(
    private readonly storage: SecureStorage,
    private readonly dialog: ConsentDialog
  ) {}

  private async loadRecord(appId: string): Promise<AppConsentRecord> {
    const raw = await this.storage.get(accountKey(appId));
    if (!raw) return { all_tools: false, tools: {} };
    try {
      return JSON.parse(raw) as AppConsentRecord;
    } catch {
      return { all_tools: false, tools: {} };
    }
  }

  private async saveRecord(appId: string, record: AppConsentRecord): Promise<void> {
    await this.storage.set(accountKey(appId), JSON.stringify(record));
  }

  async isGranted(appId: string, toolName: string): Promise<boolean> {
    const record = await this.loadRecord(appId);
    if (record.all_tools) return true;
    const tool = record.tools[toolName];
    return !!tool?.granted;
  }

  async checkAndPrompt(
    appId: string,
    appName: string,
    toolInfo: ConsentToolInfo
  ): Promise<void> {
    const record = await this.loadRecord(appId);

    if (record.all_tools) return;

    const existing = record.tools[toolInfo.name];
    if (existing?.remember) {
      if (existing.granted) return;
      // remembered denial
      throw new AaiError("CONSENT_REQUIRED", `Consent denied for tool '${toolInfo.name}'`, {
        app_id: appId,
        app_name: appName,
        tool: toolInfo.name,
        tool_description: toolInfo.description,
        tool_parameters: toolInfo.parameters,
        consent_url: `aai://consent?app=${appId}&tool=${toolInfo.name}`,
      } satisfies ConsentRequiredData);
    }

    const result = await this.dialog.show({
      appId,
      appName,
      toolName: toolInfo.name,
      toolDescription: toolInfo.description,
      parameters: toolInfo.parameters,
    });

    if (result.decision === "deny") {
      if (result.remember) {
        record.tools[toolInfo.name] = {
          granted: false,
          granted_at: new Date().toISOString(),
          remember: true,
        };
        await this.saveRecord(appId, record);
      }
      throw new AaiError("CONSENT_REQUIRED", `User denied consent for tool '${toolInfo.name}'`, {
        app_id: appId,
        app_name: appName,
        tool: toolInfo.name,
        tool_description: toolInfo.description,
        tool_parameters: toolInfo.parameters,
        consent_url: `aai://consent?app=${appId}&tool=${toolInfo.name}`,
      } satisfies ConsentRequiredData);
    }

    if (result.decision === "all") {
      record.all_tools = true;
      await this.saveRecord(appId, record);
      return;
    }

    // "tool"
    record.tools[toolInfo.name] = {
      granted: true,
      granted_at: new Date().toISOString(),
      remember: result.remember,
    };
    await this.saveRecord(appId, record);
  }
}
