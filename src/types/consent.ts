/**
 * CallerIdentity - Extracted from MCP InitializeRequest
 */
export interface CallerIdentity {
  name: string; // e.g., "Claude Desktop", "Cursor", "Windsurf"
  version?: string; // Client version if available
}
