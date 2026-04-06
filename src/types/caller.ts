export interface CallerContext {
  id: string;
  name: string;
  version?: string;
  transport: 'mcp';
  type?: 'codex' | 'claude-code' | 'opencode' | 'unknown';
}
