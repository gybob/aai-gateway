import { randomUUID } from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { logger } from '../utils/logger.js';
import { loadConfig } from '../config/config-loader.js';
import type { GatewayConfig } from '../config/config-loader.js';
import { AppRegistry, scanAllPaths } from '../config/discovery.js';
import { Errors, AutomationError } from '../errors/errors.js';
import { MacOSExecutor } from '../executors/macos.js';
import { WindowsExecutor } from '../executors/windows.js';
import { LinuxExecutor } from '../executors/linux.js';
import { WebExecutor } from '../executors/web.js';
import { getCurrentPlatform } from '../executors/base.js';
import type { AutomationExecutor } from '../executors/base.js';
import { validateParamTypes } from '../executors/param-transform.js';
import { withRetry } from '../utils/retry.js';
import { WebServer } from '../web/server.js';
import { metrics } from '../utils/metrics.js';
import { startConfigWatcher } from '../config/watcher.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { ResultCache } from '../utils/cache.js';
import { TokenManager } from '../auth/token-manager.js';
import { RegistryLoader } from '../config/registry-loader.js';

export class AAIGateway {
  private server: Server;
  private config: GatewayConfig | null = null;
  private registry: AppRegistry = new AppRegistry();
  private executors: Map<string, AutomationExecutor> = new Map();
  private webServer: WebServer | null = null;
  private scanInterval: NodeJS.Timeout | null = null;
  private rateLimiter: RateLimiter | null = null;
  private cache: ResultCache = new ResultCache();
  private tokenManager: TokenManager;
  private registryLoader: RegistryLoader | null = null;

  constructor() {
    this.server = new Server(
      {
        name: 'aai-gateway',
        version: '0.1.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.tokenManager = new TokenManager();
    this.initializeExecutors();
    this.setupHandlers();
  }

  private initializeExecutors(): void {
    const platform = getCurrentPlatform();
    this.tokenManager = new TokenManager();

    if (platform === 'macos') {
      this.executors.set('applescript', new MacOSExecutor());
      this.executors.set('jxa', new MacOSExecutor());
    } else if (platform === 'windows') {
      this.executors.set('com', new WindowsExecutor());
    } else if (platform === 'linux') {
      this.executors.set('dbus', new LinuxExecutor());
    }

    const webExecutor = new WebExecutor(this.tokenManager);
    this.executors.set('restapi', webExecutor);
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const apps = this.registry.getAll();

      return {
        resources: apps.map((app) => ({
          uri: `app:${app.appId}`,
          name: app.name,
          description: app.description ?? `${app.name} application`,
          mimeType: 'application/aai+json',
        })),
      };
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;

      if (!uri.startsWith('app:')) {
        throw new Error(`Invalid resource URI: ${uri}`);
      }

      const appId = uri.slice(4);
      const app = this.registry.get(appId);

      if (!app) {
        throw Errors.appNotFound(appId);
      }

      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(app.config, null, 2),
          },
        ],
      };
    });

    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Array<{
        name: string;
        description: string;
        inputSchema: object;
      }> = [];

      const platform = getCurrentPlatform();
      const apps = this.registry.getAll();

      for (const app of apps) {
        const platformConfig = app.config.platforms[platform];

        if (platformConfig) {
          for (const tool of platformConfig.tools) {
            tools.push({
              name: `${app.appId}:${tool.name}`,
              description: `[${app.name}] ${tool.description}`,
              inputSchema: tool.parameters,
            });
          }
        }

        if (app.config.platforms.web) {
          const webConfig = app.config.platforms.web;
          for (const tool of webConfig.tools) {
            tools.push({
              name: `${app.appId}:${tool.name}`,
              description: `[${app.name}] ${tool.description}`,
              inputSchema: tool.parameters,
            });
          }
        }
      }

      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const startTime = Date.now();
      const { name, arguments: args } = request.params;
      const [appId, toolName] = name.split(':');

      if (!appId || !toolName) {
        throw Errors.invalidParams(`Invalid tool name format: ${name}. Expected: appId:toolName`);
      }

      const app = this.registry.get(appId);
      if (!app) {
        throw Errors.appNotFound(appId);
      }

      const platform = getCurrentPlatform();
      const platformConfig = app.config.platforms[platform];
      const webConfig = app.config.platforms.web;

      let tool: any;
      let executor: AutomationExecutor | undefined;
      let script: string | object = '';

      if (platformConfig) {
        tool = platformConfig.tools.find((t) => t.name === toolName);
        if (tool) {
          executor = this.executors.get(platformConfig.automation);
          if (!executor) {
            throw Errors.automationNotSupported(platform, platformConfig.automation);
          }
          script = 'script' in tool ? tool.script : '';
        }
      }

      if (webConfig && !tool) {
        tool = webConfig.tools.find((t) => t.name === toolName);
        if (tool) {
          executor = this.executors.get('restapi');
          script = tool;
        }
      }

      if (!tool || !executor) {
        throw Errors.toolNotFound(appId, toolName);
      }

      const validation = validateParamTypes(args ?? {}, tool.parameters);
      if (!validation.valid) {
        throw Errors.invalidParams(validation.errors.join('; '));
      }

      const cacheTtl = 'cache_ttl' in tool ? (tool as any).cache_ttl : undefined;
      const cacheKey = cacheTtl ? `${appId}:${toolName}:${JSON.stringify(args)}` : undefined;

      if (cacheKey) {
        const cached = this.cache.get(cacheKey);
        if (cached) {
          logger.debug({ cacheKey }, 'Cache hit');
          return {
            content: [
              {
                type: 'text',
                text: typeof cached === 'string' ? cached : JSON.stringify(cached, null, 2),
              },
            ],
          };
        }
      }

      if (this.rateLimiter && !this.rateLimiter.tryAcquire()) {
        throw new Error('Rate limit exceeded');
      }

      try {
        const result = await withRetry(async () => {
          return await executor.execute(script, args ?? {}, {
            timeout: tool.timeout ?? this.config?.defaultTimeout ?? 30,
          });
        });

        if (!result.success) {
          if (this.webServer) {
            this.webServer.addToHistory({
              id: randomUUID(),
              timestamp: new Date(),
              appId,
              tool: toolName,
              params: (args as Record<string, unknown>) ?? {},
              success: false,
              error: result.error,
              duration: Date.now() - startTime,
            });
          }
          metrics.increment('aai_tool_calls_total', {
            app: appId,
            tool: toolName,
            status: 'failure',
          });
          return {
            content: [
              {
                type: 'text',
                text: `Error: ${result.error}`,
              },
            ],
            isError: true,
          };
        }

        if (this.webServer) {
          this.webServer.addToHistory({
            id: randomUUID(),
            timestamp: new Date(),
            appId,
            tool: toolName,
            params: (args as Record<string, unknown>) ?? {},
            success: true,
            result: result.data,
            duration: Date.now() - startTime,
          });
        }

        if (cacheKey) {
          this.cache.set(cacheKey, result.data, cacheTtl!);
        }

        metrics.increment('aai_tool_calls_total', {
          app: appId,
          tool: toolName,
          status: 'success',
        });
        metrics.observe('aai_tool_duration_seconds', (Date.now() - startTime) / 1000, {
          app: appId,
          tool: toolName,
        });

        return {
          content: [
            {
              type: 'text',
              text:
                typeof result.data === 'string'
                  ? result.data
                  : JSON.stringify(result.data, null, 2),
            },
          ],
        };
      } catch (error) {
        if (this.webServer) {
          this.webServer.addToHistory({
            id: randomUUID(),
            timestamp: new Date(),
            appId,
            tool: toolName,
            params: (args as Record<string, unknown>) ?? {},
            success: false,
            error: error instanceof Error ? error.message : String(error),
            duration: Date.now() - startTime,
          });
        }
        metrics.increment('aai_tool_calls_total', {
          app: appId,
          tool: toolName,
          status: 'error',
        });
        if (AutomationError.isAutomationError(error)) {
          return {
            content: [
              {
                type: 'text',
                text: `${error.message}: ${error.detail ?? ''}`,
              },
            ],
            isError: true,
          };
        }
        throw error;
      }
    });
  }

  async initialize(): Promise<void> {
    logger.info('Initializing AAI Gateway...');

    this.config = await loadConfig();
    this.registry = await scanAllPaths(this.config.scanPaths);

    if (this.config.rateLimit) {
      this.rateLimiter = new RateLimiter(
        this.config.rateLimit.maxTokens,
        this.config.rateLimit.refillRate
      );
    }

    this.registryLoader = new RegistryLoader(this.config);
    await this.registryLoader.syncFromRegistry(this.registry);

    await this.tokenManager.init();

    const webExecutor = this.executors.get('restapi') as WebExecutor;
    if (webExecutor) {
      for (const app of this.registry.getAll()) {
        if (app.config.platforms.web) {
          const webConfig = app.config.platforms.web;
          webExecutor.registerApp(
            app.appId,
            webConfig.base_url,
            webConfig.auth,
            webConfig.default_headers ?? {}
          );
        }
      }
    }

    startConfigWatcher(this.config.scanPaths, async () => {
      if (!this.config) return;
      const newRegistry = await scanAllPaths(this.config.scanPaths);
      this.registry.clear();
      newRegistry.getAll().forEach((app) => this.registry.register(app));
      logger.info('Configuration reloaded from file change');
    });

    logger.info({ appCount: this.registry.size }, 'AAI Gateway initialized');

    if (this.config.enableWebUI) {
      this.webServer = new WebServer(this.config, this.registry);
      const port = this.config.httpPort ?? 3000;
      await this.webServer.start(port);
    }
  }

  async start(enableStdio: boolean = true): Promise<void> {
    await this.initialize();

    if (enableStdio) {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      logger.info('AAI Gateway started (stdio mode)');
    }

    if (this.config?.enableWebUI) {
      this.webServer = new WebServer(this.config, this.registry);
      const port = this.config.httpPort ?? 3000;
      await this.webServer.start(port);
    }

    this.startScanInterval();
  }

  private startScanInterval(): void {
    if (this.config?.scanIntervalMinutes && this.config.scanIntervalMinutes > 0) {
      const intervalMs = this.config.scanIntervalMinutes * 60 * 1000;
      this.scanInterval = setInterval(async () => {
        logger.info('Starting scheduled scan...');
        try {
          if (!this.config) return;
          const newRegistry = await scanAllPaths(this.config.scanPaths);
          this.registry.clear();
          newRegistry.getAll().forEach((app) => this.registry.register(app));
          logger.info({ appCount: this.registry.size }, 'Scheduled scan complete');
        } catch (error) {
          logger.error({ error }, 'Scheduled scan failed');
        }
      }, intervalMs);
      this.scanInterval.unref();
    }
  }

  getRegistry(): AppRegistry {
    return this.registry;
  }

  getConfig(): GatewayConfig | null {
    return this.config;
  }

  enableWebUI(port?: number): void {
    if (this.config) {
      this.config.enableWebUI = true;
      if (port) {
        this.config.httpPort = port;
      }
    }
  }
}

export async function createGateway(): Promise<AAIGateway> {
  const gateway = new AAIGateway();
  return gateway;
}
