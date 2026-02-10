import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

import { logger } from '../utils/logger.js';
import { AppRegistry, DiscoveredApp } from './discovery.js';
import { validateAaiJson } from '../parsers/schema.js';
import type { GatewayConfig } from './config-loader.js';

interface RegistryApp {
  appId: string;
  name: string;
  descriptorUrl: string;
  descriptorJson: unknown;
}

interface RegistryResponse {
  apps: RegistryApp[];
}

export class RegistryLoader {
  private cacheDir: string;
  private enabled: boolean;
  private registryUrl: string;

  constructor(config: GatewayConfig) {
    this.cacheDir = join(homedir(), '.aai', 'web');
    this.enabled = (config as any).enableRegistry ?? true;
    this.registryUrl = (config as any).registryUrl ?? 'http://localhost:8080/api/v1';
  }

  async syncFromRegistry(registry: AppRegistry): Promise<void> {
    if (!this.enabled) {
      logger.debug('Registry sync disabled');
      return;
    }

    logger.info({ url: this.registryUrl }, 'Syncing apps from registry');

    if (!existsSync(this.cacheDir)) {
      await mkdir(this.cacheDir, { recursive: true });
    }

    let apps: RegistryApp[];
    try {
      const response = await fetch(`${this.registryUrl}/apps`);

      if (!response.ok) {
        throw new Error(`Registry responded with ${response.status}`);
      }

      const data = (await response.json()) as RegistryResponse;
      apps = data.apps;
    } catch (error) {
      logger.warn({ url: this.registryUrl, error }, 'Failed to fetch from registry, using cache');

      await this.loadFromCache(registry);
      return;
    }

    for (const app of apps) {
      await this.cacheApp(app);
      await this.registerFromCache(registry, app.appId);
    }

    logger.info({ count: apps.length }, 'Apps synced from registry');
  }

  private async cacheApp(app: RegistryApp): Promise<void> {
    const appDir = join(this.cacheDir, app.appId);
    const filePath = join(appDir, 'aai.json');

    await mkdir(appDir, { recursive: true });
    await writeFile(filePath, JSON.stringify(app.descriptorJson, null, 2), 'utf-8');
    logger.debug({ appId: app.appId, path: filePath }, 'App cached');
  }

  private async loadFromCache(registry: AppRegistry): Promise<void> {
    if (!existsSync(this.cacheDir)) {
      logger.debug('No cache found');
      return;
    }

    const entries = await import('fs/promises').then((fs) => fs.readdir(this.cacheDir));

    for (const entry of entries) {
      if (entry === '.DS_Store' || entry === '.gitkeep') continue;

      await this.registerFromCache(registry, entry);
    }

    logger.info({ count: entries.length }, 'Apps loaded from cache');
  }

  private async registerFromCache(registry: AppRegistry, appId: string): Promise<void> {
    const filePath = join(this.cacheDir, appId, 'aai.json');

    if (!existsSync(filePath)) {
      logger.debug({ appId }, 'Cache file not found');
      return;
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const rawConfig = JSON.parse(content) as unknown;
      const config = validateAaiJson(rawConfig);

      if (!config.platforms.web) {
        logger.debug({ appId }, 'App has no web platform');
        return;
      }

      const app: DiscoveredApp = {
        appId: config.appId,
        name: config.name,
        description: config.description,
        path: dirname(filePath),
        config,
      };

      registry.register(app);
      logger.debug({ appId: config.appId, name: config.name }, 'Web app registered');
    } catch (error) {
      logger.warn({ appId, error }, 'Failed to load app from cache');
    }
  }
}
