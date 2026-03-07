export interface ConsentDialogInfo {
  callerName: string;  // Name of the MCP client making the request
  appId: string;
  appName: string;
  toolName: string;
  toolDescription: string;
  parameters: object;
}

export interface ConsentDialogResult {
  decision: "tool" | "all" | "deny";
  remember: boolean;
}

export interface ConsentDialog {
  show(info: ConsentDialogInfo): Promise<ConsentDialogResult>;
}
