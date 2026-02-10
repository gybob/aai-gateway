import { Platform } from '../parsers/schema.js';
import type { AutomationExecutor, ExecutionResult, ExecutorOptions } from './base.js';
import { TokenManager } from '../auth/token-manager.js';
import { logger } from '../utils/logger.js';

interface WebAppConfig {
  appId: string;
  baseUrl: string;
  auth: any;
  defaultHeaders: Record<string, string>;
}

export class WebExecutor implements AutomationExecutor {
  readonly platform: Platform = 'web';
  private tokenManager: TokenManager;
  private appConfigs: Map<string, WebAppConfig> = new Map();

  constructor(tokenManager?: TokenManager) {
    this.tokenManager = tokenManager ?? new TokenManager();
  }

  registerApp(appId: string, baseUrl: string, auth: any, defaultHeaders: Record<string, string>): void {
    this.appConfigs.set(appId, { appId, baseUrl, auth, defaultHeaders });
    logger.debug({ appId, baseUrl }, 'Web app registered');
  }

  isSupported(): boolean {
    return true;
  }

  async execute(
    toolDef: any,
    params: Record<string, unknown>,
    options?: ExecutorOptions
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    const appId = this.findAppIdForTool(toolDef.name);
    const config = appId ? this.appConfigs.get(appId) : null;

    if (!config) {
      return {
        success: false,
        error: `App configuration not found for tool: ${toolDef.name}`,
        duration: Date.now() - startTime,
      };
    }

    const auth = await this.tokenManager.resolveAuth(config.appId, config.auth);

    if (!auth) {
      if (config.auth.type === 'oauth2') {
        return {
          success: false,
          error: `Authorization required. Please run: aai-gateway authorize ${config.appId}`,
          duration: Date.now() - startTime,
        };
      }
      logger.warn({ appId: config.appId, authType: config.auth.type }, 'Auth credentials not found');
      return {
        success: false,
        error: `Auth credentials not found. Check environment variables for ${config.appId}`,
        duration: Date.now() - startTime,
      };
    }

    const url = this.buildUrl(config.baseUrl, toolDef.endpoint, params, toolDef.query_params);
    const headers = this.buildHeaders(config.defaultHeaders, toolDef.headers, auth);
    const body = this.buildBody(toolDef.body, params, toolDef.method);

    const controller = new AbortController();
    const timeout = options?.timeout ?? 30000;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      logger.debug({ url, method: toolDef.method }, 'Executing HTTP request');

      const response = await fetch(url, {
        method: toolDef.method,
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const duration = Date.now() - startTime;

      if (response.status === 401) {
        await this.tokenManager.deleteToken(config.appId);
        return {
          success: false,
          error: 'Authentication failed. Token may be expired.',
          duration,
        };
      }

      if (response.status === 403) {
        return {
          success: false,
          error: 'Forbidden. Insufficient permissions.',
          duration,
        };
      }

      if (!response.ok) {
        const text = await response.text();
        return {
          success: false,
          error: `API request failed: ${response.status} ${text}`,
          duration,
        };
      }

      const contentType = response.headers.get('content-type') || '';
      const outputType = toolDef.output_parser ?? 'json';

      let data: unknown;

      if (outputType === 'json' && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      return {
        success: true,
        data,
        duration,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        return {
          success: false,
          error: `Request timeout after ${timeout}ms`,
          duration: Date.now() - startTime,
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      };
    }
  }

  private findAppIdForTool(toolName: string): string | undefined {
    for (const [appId, config] of this.appConfigs.entries()) {
      if (toolName.startsWith(appId) || this.isToolInApp(toolName, config)) {
        return appId;
      }
    }
    return undefined;
  }

  private isToolInApp(_toolName: string, _config: WebAppConfig): boolean {
    return true;
  }

  private buildUrl(
    baseUrl: string,
    endpoint: string,
    params: Record<string, unknown>,
    queryParams?: Record<string, string>
  ): string {
    let url = baseUrl.replace(/\/$/, '') + endpoint.replace(/^\//, '');

    const pathParams = this.extractPathParams(endpoint);
    for (const param of pathParams) {
      if (param in params) {
        url = url.replace(`\${${param}}`, encodeURIComponent(String(params[param])));
      }
    }

    if (queryParams) {
      const urlObj = new URL(url);
      for (const [key, value] of Object.entries(queryParams)) {
        const resolvedValue = this.resolveTemplate(value, params);
        urlObj.searchParams.set(key, resolvedValue);
      }
      url = urlObj.toString();
    }

    return url;
  }

  private extractPathParams(endpoint: string): string[] {
    const matches = endpoint.matchAll(/\$\{(\w+)\}/g);
    return Array.from(matches, (m) => m[1]);
  }

  private resolveTemplate(template: string, params: Record<string, unknown>): string {
    return template.replace(/\$\{(\w+)\}/g, (_, key) => {
      if (key in params) {
        return String(params[key]);
      }
      return template;
    });
  }

  private buildHeaders(
    defaultHeaders: Record<string, string>,
    toolHeaders: Record<string, string> = {},
    auth: { header?: string; query?: Record<string, string> }
  ): Record<string, string> {
    const headers: Record<string, string> = { ...defaultHeaders, ...toolHeaders };

    if (auth.header) {
      const [key, value] = auth.header.split(': ');
      headers[key] = value;
    }

    return headers;
  }

  private buildBody(
    bodyTemplate: any,
    params: Record<string, unknown>,
    method: string
  ): string | undefined {
    if (method === 'GET' || method === 'HEAD' || method === 'DELETE') {
      return undefined;
    }

    if (!bodyTemplate) {
      return undefined;
    }

    const resolved = this.deepResolveTemplate(bodyTemplate, params);
    return JSON.stringify(resolved);
  }

  private deepResolveTemplate(obj: unknown, params: Record<string, unknown>): unknown {
    if (typeof obj === 'string') {
      return this.resolveTemplate(obj, params);
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.deepResolveTemplate(item, params));
    }

    if (typeof obj === 'object' && obj !== null) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        result[key] = this.deepResolveTemplate(value, params);
      }
      return result;
    }

    return obj;
  }
}
