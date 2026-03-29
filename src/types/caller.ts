export interface CallerContext {
  id: string;
  name: string;
  version?: string;
  transport: 'mcp' | 'skill-cli';
  type?: 'codex' | 'claude-code' | 'opencode' | 'unknown';
  skillDir?: string;
}
