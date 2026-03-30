/**
 * Unified capability types for AAI Gateway executors
 */

// Tool schema with full parameter definitions
export interface ToolSchema {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

// App-level capabilities (工具列表，含完整 schema)
export interface AppCapabilities {
  title: string;
  tools: ToolSchema[];
}
