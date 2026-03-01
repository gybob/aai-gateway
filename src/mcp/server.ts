import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { logger } from "../utils/logger.js";
import { AaiError } from "../errors/errors.js";
import { createDesktopDiscovery, type DiscoveryOptions } from "../discovery/index.js";
import { fetchWebDescriptor } from "../discovery/web.js";
import { createSecureStorage } from "../storage/secure-storage/index.js";
import { createConsentDialog } from "../consent/dialog/index.js";
import { ConsentManager } from "../consent/manager.js";
import { createIpcExecutor } from "../executors/ipc/index.js";
import { executeWebTool } from "../executors/web.js";
import { TokenManager } from "../auth/token-manager.js";
import type { DiscoveredDesktopApp } from "../discovery/interface.js";
import type { AaiJson } from "../types/aai-json.js";

export class AaiGatewayServer {
  private readonly server: Server;
  private readonly desktopRegistry = new Map<string, DiscoveredDesktopApp>();
  private consentManager!: ConsentManager;
  private tokenManager!: TokenManager;
  private readonly options: DiscoveryOptions;

  constructor(options?: DiscoveryOptions) {
    this.options = options ?? {};
    this.server = new Server(
      { name: "aai-gateway", version: "0.1.0" },
      { capabilities: { resources: {}, tools: {} } }
    );
    this.setupHandlers();
  }

  async initialize(): Promise<void> {
    const storage = createSecureStorage();
    const dialog = createConsentDialog();
    this.consentManager = new ConsentManager(storage, dialog);
    this.tokenManager = new TokenManager(storage);

    // Scan desktop apps
    try {
      const discovery = createDesktopDiscovery();
      const apps = await discovery.scan(this.options);
      for (const app of apps) {
        this.desktopRegistry.set(app.appId, app);
      }
      logger.info({ count: apps.length }, "Desktop apps discovered");
    } catch (err) {
      if (AaiError.isAaiError(err) && err.code === "NOT_IMPLEMENTED") {
        logger.warn("Desktop discovery not supported on this platform");
      } else {
        logger.error({ err }, "Desktop discovery failed");
      }
    }
  }

  private setupHandlers(): void {
    // resources/list — returns discovered desktop apps
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources = Array.from(this.desktopRegistry.values()).map((app) => ({
        uri: `app:${app.appId}`,
        name: app.name,
        description: app.description,
        mimeType: "application/aai+json",
      }));
      return { resources };
    });

    // tools/list — returns all discovered tools from all apps
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Array<{
        name: string;
        description: string;
        inputSchema: object;
      }> = [];

      // Collect tools from all discovered desktop apps
      for (const app of this.desktopRegistry.values()) {
        for (const tool of app.descriptor.tools) {
          tools.push({
            name: `${app.appId}:${tool.name}`,
            description: tool.description,
            inputSchema: tool.parameters ?? { type: "object", properties: {} },
          });
        }
      }

      logger.debug({ toolCount: tools.length }, "tools/list requested");
      return { tools };
    });

    // resources/read — by app URI or web URL
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      let descriptor: AaiJson;

      if (uri.startsWith("app:")) {
        const appId = uri.slice(4);
        const app = this.desktopRegistry.get(appId);
        if (!app) {
          throw new AaiError("UNKNOWN_APP", `App '${appId}' not found in registry`);
        }
        descriptor = app.descriptor;
      } else if (uri.startsWith("https://") || uri.startsWith("http://")) {
        descriptor = await fetchWebDescriptor(uri);
      } else {
        throw new AaiError("INVALID_REQUEST", `Unknown URI scheme: ${uri}`);
      }

      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(descriptor, null, 2),
          },
        ],
      };
    });

    // tools/call — name = "<app_id>:<tool_name>"
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const colonIdx = name.indexOf(":");
      if (colonIdx === -1) {
        throw new AaiError(
          "INVALID_REQUEST",
          `Invalid tool name format '${name}'. Expected: <app_id>:<tool_name>`
        );
      }

      const appId = name.slice(0, colonIdx);
      const toolName = name.slice(colonIdx + 1);

      // Resolve descriptor
      let descriptor: AaiJson;
      let appName: string;

      const desktopApp = this.desktopRegistry.get(appId);
      if (desktopApp) {
        descriptor = desktopApp.descriptor;
        appName = desktopApp.name;
      } else {
        // treat appId as a URL for web apps
        descriptor = await fetchWebDescriptor(appId);
        appName = descriptor.app.name;
      }

      // Find tool
      const tool = descriptor.tools.find((t) => t.name === toolName);
      if (!tool) {
        throw new AaiError("UNKNOWN_TOOL", `Tool '${toolName}' not found in '${appId}'`);
      }

      // Consent check
      await this.consentManager.checkAndPrompt(descriptor.app.id, appName, {
        name: toolName,
        description: tool.description,
        parameters: tool.parameters,
      });

      // Execute
      let result: unknown;
      if (descriptor.platform === "web") {
        const accessToken = await this.tokenManager.getValidToken(descriptor.app.id, descriptor);
        result = await executeWebTool(descriptor, toolName, args ?? {}, accessToken);
      } else {
        const ipcExecutor = createIpcExecutor();
        result = await ipcExecutor.execute(descriptor.app.id, toolName, args ?? {});
      }

      return {
        content: [
          {
            type: "text",
            text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    });
  }

  async start(): Promise<void> {
    await this.initialize();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info("AAI Gateway started (stdio)");
  }
}

export async function createGatewayServer(options?: DiscoveryOptions): Promise<AaiGatewayServer> {
  return new AaiGatewayServer(options);
}
