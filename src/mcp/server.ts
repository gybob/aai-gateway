import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { logger } from '../utils/logger.js';
import { AaiError } from '../errors/errors.js';
import { createDesktopDiscovery, type DiscoveryOptions } from '../discovery/index.js';
import { fetchWebDescriptor } from '../discovery/web.js';
import { createSecureStorage } from '../storage/secure-storage/index.js';
import { createConsentDialog } from '../consent/dialog/index.js';
import { ConsentManager } from '../consent/manager.js';
import { createIpcExecutor } from '../executors/ipc/index.js';
import { executeWebTool } from '../executors/web.js';
import { TokenManager } from '../auth/token-manager.js';
import {
  generateAppListDescription,
  generateOperationGuide,
  parseMultiLanguageName,
} from './guide-generator.js';
import type { DiscoveredDesktopApp } from '../discovery/interface.js';
import type { AaiJson } from '../types/aai-json.js';

export class AaiGatewayServer {
  private readonly server: Server;
  private readonly desktopRegistry = new Map<string, DiscoveredDesktopApp>();
  private consentManager!: ConsentManager;
  private tokenManager!: TokenManager;
  private readonly options: DiscoveryOptions;

  constructor(options?: DiscoveryOptions) {
    this.options = options ?? {};
    this.server = new Server(
      { name: 'aai-gateway', version: '0.2.0' },
      { capabilities: { tools: {} } }
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
      logger.info({ count: apps.length }, 'Desktop apps discovered');
    } catch (err) {
      if (AaiError.isAaiError(err) && err.code === 'NOT_IMPLEMENTED') {
        logger.warn('Desktop discovery not supported on this platform');
      } else {
        logger.error({ err }, 'Desktop discovery failed');
      }
    }
  }

  private setupHandlers(): void {
    // tools/list — returns app entries + web:discover + aai:exec
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Array<{
        name: string;
        description: string;
        inputSchema: object;
      }> = [];

      // Desktop apps (one entry per app)
      for (const app of this.desktopRegistry.values()) {
        const description = generateAppListDescription({
          appId: app.appId,
          name: app.descriptor.app.name,
          description: app.descriptor.app.description,
          aliases: app.descriptor.app.aliases,
        });
        tools.push({
          name: `app:${app.appId}`,
          description,
          inputSchema: { type: 'object', properties: {} },
        });
      }

      // Web discovery tool
      tools.push({
        name: 'web:discover',
        description:
          'Discover and get operation guide for a Web application. Use when user mentions a web service not in the known apps list. Supports URL, domain, or service name.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'Web app URL, domain, or service name (e.g., notion.com, github)',
            },
          },
          required: ['url'],
        },
      });

      // Universal execution tool
      tools.push({
        name: 'aai:exec',
        description:
          'Execute an app operation. Use after reading the operation guide. Parameters: app (app ID or URL), tool (operation name), args (parameters object).',
        inputSchema: {
          type: 'object',
          properties: {
            app: {
              type: 'string',
              description: 'App identifier (e.g., com.apple.reminders) or Web app URL',
            },
            tool: {
              type: 'string',
              description: 'Operation name (e.g., create_reminder)',
            },
            args: {
              type: 'object',
              description: 'Operation parameters as described in the guide',
              additionalProperties: true,
            },
          },
          required: ['app', 'tool'],
        },
      });

      logger.debug({ toolCount: tools.length }, 'tools/list requested');
      return { tools };
    });

    // tools/call — handle app:*, web:discover, aai:exec
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Handle app:* calls — return operation guide
      if (name.startsWith('app:')) {
        const appId = name.slice(4);
        return await this.handleAppGuide(appId);
      }

      // Handle web:discover — fetch and return guide
      if (name === 'web:discover') {
        const url = (args as { url?: string })?.url;
        if (!url) {
          throw new AaiError('INVALID_REQUEST', "Missing 'url' parameter");
        }
        return await this.handleWebDiscover(url);
      }

      // Handle aai:exec — execute operation
      if (name === 'aai:exec') {
        const {
          app,
          tool,
          args: toolArgs,
        } = args as {
          app: string;
          tool: string;
          args?: Record<string, unknown>;
        };
        return await this.handleExec(app, tool, toolArgs ?? {});
      }

      throw new AaiError('UNKNOWN_TOOL', `Unknown tool: ${name}`);
    });
  }

  private async handleAppGuide(
    appId: string
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    const app = this.desktopRegistry.get(appId);
    if (!app) {
      throw new AaiError('UNKNOWN_APP', `App not found: ${appId}`);
    }

    const guide = generateOperationGuide(appId, app.descriptor, 'desktop');
    return {
      content: [{ type: 'text', text: guide }],
    };
  }

  private async handleWebDiscover(
    urlInput: string
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    const normalizedUrl = this.normalizeUrl(urlInput);
    const descriptor = await fetchWebDescriptor(normalizedUrl);

    const guide = generateOperationGuide(normalizedUrl, descriptor, 'web');
    return {
      content: [{ type: 'text', text: guide }],
    };
  }

  private async handleExec(
    appId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    // Resolve descriptor
    let descriptor: AaiJson;
    let appName: string;
    let platform: 'desktop' | 'web';

    const desktopApp = this.desktopRegistry.get(appId);
    if (desktopApp) {
      descriptor = desktopApp.descriptor;
      appName = desktopApp.name;
      platform = 'desktop';
    } else {
      // Treat as web app URL
      const normalizedUrl = this.normalizeUrl(appId);
      descriptor = await fetchWebDescriptor(normalizedUrl);
      appName = parseMultiLanguageName(descriptor.app.name)[0];
      platform = 'web';
    }

    // Find tool
    const tool = descriptor.tools.find((t) => t.name === toolName);
    if (!tool) {
      throw new AaiError('UNKNOWN_TOOL', `Tool '${toolName}' not found in '${appId}'`);
    }

    // Consent check
    await this.consentManager.checkAndPrompt(descriptor.app.id, appName, {
      name: toolName,
      description: tool.description,
      parameters: tool.parameters,
    });

    // Execute
    let result: unknown;
    if (platform === 'web') {
      const accessToken = await this.tokenManager.getValidToken(descriptor.app.id, descriptor);
      result = await executeWebTool(descriptor, toolName, args, accessToken);
    } else {
      const ipcExecutor = createIpcExecutor();
      result = await ipcExecutor.execute(descriptor.app.id, toolName, args);
    }

    return {
      content: [
        {
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private normalizeUrl(input: string): string {
    // Already a URL
    if (input.startsWith('https://') || input.startsWith('http://')) {
      return input;
    }

    // Domain only
    if (input.includes('.') && !input.includes('/')) {
      return `https://${input}`;
    }

    // Try as domain
    return `https://${input}`;
  }

  async start(): Promise<void> {
    await this.initialize();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('AAI Gateway started (stdio)');
  }
}

export async function createGatewayServer(options?: DiscoveryOptions): Promise<AaiGatewayServer> {
  return new AaiGatewayServer(options);
}
