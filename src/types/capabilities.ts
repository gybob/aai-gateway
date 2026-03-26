/**
 * Unified capability types for AAI Gateway executors
 */

// Tool summary for app capabilities (不含参数定义)
export interface ToolSummary {
  name: string;
  description: string;
}

// App-level capabilities (工具列表)
export interface AppCapabilities {
  title: string;
  tools: ToolSummary[];
}

// Single tool schema (含参数定义)
export interface ToolSchema {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}
