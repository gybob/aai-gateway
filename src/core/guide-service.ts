/**
 * Guide Service
 *
 * Handles generation of guides and tool summaries.
 */

import type { AaiJson, RuntimeAppRecord } from '../types/aai-json.js';
import type { AppCapabilities } from '../types/capabilities.js';
import {
  generateAppGuideMarkdown,
  generateGuideToolSummary,
} from '../guides/app-guide-generator.js';

export class GuideService {
  generateAppGuide(appId: string, descriptor: AaiJson, capabilities: AppCapabilities): string {
    return generateAppGuideMarkdown(appId, descriptor, capabilities);
  }

  generateToolSummary(appId: string, descriptor: AaiJson): string {
    return generateGuideToolSummary(appId, descriptor);
  }

  buildToolListForCaller(
    apps: RuntimeAppRecord[],
    gatewayToolDefinitions: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      listInputSchema?: Record<string, unknown>;
    }>
  ): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return [
      ...apps.map((app) => ({
        name: `app:${app.appId}`,
        description: this.generateToolSummary(app.appId, app.descriptor),
        inputSchema: { type: 'object', properties: {} },
      })),
      ...gatewayToolDefinitions.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.listInputSchema ?? tool.inputSchema,
      })),
    ];
  }
}
