#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDesktopDiscovery } from './discovery/index.js';
import { getMcpExecutor } from './executors/mcp.js';
import {
  buildMcpImportConfig,
  buildSkillExposure,
  type ExposureMode,
  buildSkillImportSource,
  importMcpServer,
  importSkill,
  refreshImportedMcpServer,
} from './mcp/importer.js';
import { createGatewayServer } from './mcp/server.js';
import { getMcpRegistryEntry, upsertMcpRegistryEntry } from './storage/mcp-registry.js';
import { getManagedAppDir } from './storage/paths.js';
import { createSecureStorage } from './storage/secure-storage/index.js';
import { upsertSkillRegistryEntry } from './storage/skill-registry.js';
import { isMcpAccess, isSkillAccess, isSkillPathConfig, type AaiJson } from './types/aai-json.js';
import { logger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));
const VERSION = packageJson.version;

interface CommonOptions {
  dev: boolean;
}

interface ServeOptions extends CommonOptions {
  command: 'serve';
}

interface ScanOptions extends CommonOptions {
  command: 'scan';
}

interface ImportOptionsBase extends CommonOptions {
  exposure: ExposureMode;
}

interface McpImportOptions extends ImportOptionsBase {
  command: 'mcp-import';
  transport?: 'streamable-http' | 'sse';
  url?: string;
  launchCommand?: string;
  launchArgs: string[];
  launchEnv: Record<string, string>;
  launchCwd?: string;
  headers: Record<string, string>;
}

interface McpRefreshOptions extends ImportOptionsBase {
  command: 'mcp-refresh';
  localId: string;
}

interface SkillImportOptions extends ImportOptionsBase {
  command: 'skill-import';
  path?: string;
  url?: string;
}

interface AppConfigOptions extends CommonOptions {
  command: 'app-config';
  localId: string;
  exposure?: ExposureMode;
  keywords?: string[];
  summary?: string;
}

type CliOptions =
  | ServeOptions
  | ScanOptions
  | McpImportOptions
  | McpRefreshOptions
  | SkillImportOptions
  | AppConfigOptions;

function parseKeyValue(value: string, flag: string): [string, string] {
  const index = value.indexOf('=');
  if (index === -1) {
    throw new Error(`${flag} expects KEY=VALUE`);
  }
  return [value.slice(0, index), value.slice(index + 1)];
}

function parseArgs(args: string[]): CliOptions {
  const dev = args.includes('--dev');
  if (args.includes('--scan')) {
    return { command: 'scan', dev };
  }

  if (args[0] === 'mcp' && args[1] === 'import') {
    const base = parseImportBase(args.slice(2), dev);
    let transport: 'streamable-http' | 'sse' | undefined;
    let url: string | undefined;
    let launchCommand: string | undefined;
    let launchCwd: string | undefined;
    const launchArgs: string[] = [];
    const launchEnv: Record<string, string> = {};
    const headers: Record<string, string> = {};

    for (let i = 2; i < args.length; i += 1) {
      const arg = args[i];
      const next = args[i + 1];
      switch (arg) {
        case '--exposure':
          i += 1;
          break;
        case '--dev':
          if (arg !== '--dev') i += 1;
          break;
        case '--transport':
          if (next !== 'streamable-http' && next !== 'sse') {
            throw new Error('--transport must be streamable-http or sse');
          }
          transport = next;
          i += 1;
          break;
        case '--url':
          url = next;
          i += 1;
          break;
        case '--command':
          launchCommand = next;
          i += 1;
          break;
        case '--arg':
          launchArgs.push(next);
          i += 1;
          break;
        case '--env': {
          const [key, value] = parseKeyValue(next, '--env');
          launchEnv[key] = value;
          i += 1;
          break;
        }
        case '--cwd':
          launchCwd = next;
          i += 1;
          break;
        case '--header': {
          const [key, value] = parseKeyValue(next, '--header');
          headers[key] = value;
          i += 1;
          break;
        }
        default:
          if (!arg.startsWith('--')) break;
          if (
            ![
              '--dev',
              '--exposure',
              '--transport',
              '--url',
              '--command',
              '--arg',
              '--env',
              '--cwd',
              '--header',
            ].includes(arg)
          ) {
            throw new Error(`Unknown argument: ${arg}`);
          }
      }
    }

    return {
      command: 'mcp-import',
      ...base,
      transport,
      url,
      launchCommand,
      launchArgs,
      launchEnv,
      launchCwd,
      headers,
    };
  }

  if (args[0] === 'mcp' && args[1] === 'refresh') {
    const localId = args[2];
    if (!localId) {
      throw new Error('Usage: aai-gateway mcp refresh <local-id>');
    }
    const base = parseImportBase(args.slice(3), dev);
    return { command: 'mcp-refresh', localId, ...base };
  }

  if (args[0] === 'skill' && args[1] === 'import') {
    const base = parseImportBase(args.slice(2), dev);
    let path: string | undefined;
    let url: string | undefined;
    for (let i = 2; i < args.length; i += 1) {
      const arg = args[i];
      const next = args[i + 1];
      switch (arg) {
        case '--exposure':
          i += 1;
          break;
        case '--dev':
          if (arg !== '--dev') i += 1;
          break;
        case '--path':
          path = next;
          i += 1;
          break;
        case '--url':
          url = next;
          i += 1;
          break;
        default:
          if (arg.startsWith('--') && !['--path', '--url', '--exposure'].includes(arg)) {
            throw new Error(`Unknown argument: ${arg}`);
          }
      }
    }
    return { command: 'skill-import', ...base, path, url };
  }

  if (args[0] === 'app' && args[1] === 'config') {
    const localId = args[2];
    if (!localId) {
      throw new Error('Usage: aai-gateway app config <local-id>');
    }

    let exposure: ExposureMode | undefined;
    let summary: string | undefined;
    const keywords: string[] = [];

    for (let i = 3; i < args.length; i += 1) {
      const arg = args[i];
      const next = args[i + 1];
      switch (arg) {
        case '--dev':
          break;
        case '--exposure':
          if (next !== 'summary' && next !== 'keywords') {
            throw new Error('--exposure must be summary or keywords');
          }
          exposure = next;
          i += 1;
          break;
        case '--summary':
          summary = next;
          i += 1;
          break;
        case '--keyword':
          keywords.push(next);
          i += 1;
          break;
        default:
          if (arg.startsWith('--') && !['--dev', '--exposure', '--summary', '--keyword'].includes(arg)) {
            throw new Error(`Unknown argument: ${arg}`);
          }
      }
    }

    return {
      command: 'app-config',
      dev,
      localId,
      ...(exposure ? { exposure } : {}),
      ...(summary ? { summary } : {}),
      ...(keywords.length > 0 ? { keywords } : {}),
    };
  }

  return { command: 'serve', dev };
}

function parseImportBase(args: string[], dev: boolean): ImportOptionsBase {
  let exposure: ExposureMode | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--exposure':
        if (next !== 'summary' && next !== 'keywords') {
          throw new Error('--exposure must be summary or keywords');
        }
        exposure = next;
        i += 1;
        break;
      case '--dev':
        break;
      default:
        break;
    }
  }

  if (!exposure) {
    throw new Error('Import requires --exposure summary|keywords');
  }

  return { dev, exposure };
}

function printHelp(): void {
  console.log(`
AAI Gateway

Usage:
  aai-gateway [options]
  aai-gateway mcp import [options]
  aai-gateway mcp refresh <local-id> [options]
  aai-gateway skill import [options]
  aai-gateway app config <local-id> [options]

Options:
  --scan        Scan for desktop descriptors and exit
  --dev         Enable development mode
  --version     Show version
  --help, -h    Show help

Shared import options:
  --exposure MODE        Required. One of: summary, keywords

MCP import options:
  --command CMD          Import a local stdio MCP server
  --arg VALUE            Repeatable stdio argument
  --env KEY=VALUE        Repeatable stdio environment variable
  --cwd DIR              Working directory for stdio launch
  --url URL              Import a remote MCP server
  --transport TYPE       Remote transport: streamable-http or sse
  --header KEY=VALUE     Repeatable remote header stored in secure storage

Skill import options:
  --path DIR             Import a local skill directory
  --url URL              Import a remote skill root URL

App config options:
  --exposure MODE        Optional. Regenerate metadata using summary or keywords mode
  --summary TEXT         Optional. Override the generated summary
  --keyword VALUE        Optional and repeatable. Override generated keywords
`);
}

async function runScan(dev: boolean): Promise<void> {
  const discovery = createDesktopDiscovery();
  const apps = await discovery.scan({ devMode: dev });

  if (apps.length === 0) {
    console.log('No desktop descriptors found.');
    return;
  }

  for (const app of apps) {
    console.log(`${app.localId}`);
    console.log(`  Name: ${app.descriptor.app.name.default}`);
    console.log(`  Location: ${app.location ?? '(unknown)'}`);
    console.log(`  Protocol: ${app.descriptor.access.protocol}`);
    console.log(`  Summary: ${app.descriptor.exposure.summary}`);
  }
}

async function runMcpImport(options: McpImportOptions): Promise<void> {
  const storage = createSecureStorage();
  const executor = getMcpExecutor();
  const config = buildMcpImportConfig({
    transport: options.transport,
    url: options.url,
    command: options.launchCommand,
    args: options.launchArgs,
    env: options.launchEnv,
    cwd: options.launchCwd,
  });

  const result = await importMcpServer(executor, storage, {
    config,
    headers: options.headers,
    exposureMode: options.exposure,
  });

  console.log(`Imported MCP app: ${result.entry.localId}`);
  console.log(`Descriptor: ${result.entry.descriptorPath}`);
  console.log(`Managed directory: ${getManagedAppDir(result.entry.localId)}`);
  console.log(`Keywords: ${result.descriptor.exposure.keywords.join(', ')}`);
  console.log(`Summary: ${result.descriptor.exposure.summary}`);
}

async function runMcpRefresh(options: McpRefreshOptions): Promise<void> {
  const entry = await getMcpRegistryEntry(options.localId);
  if (!entry) {
    throw new Error(`Unknown imported MCP app: ${options.localId}`);
  }

  const result = await refreshImportedMcpServer(
    getMcpExecutor(),
    createSecureStorage(),
    entry,
    options.exposure
  );

  console.log(`Refreshed MCP app: ${result.entry.localId}`);
  console.log(`Descriptor: ${result.entry.descriptorPath}`);
}

async function runSkillImport(options: SkillImportOptions): Promise<void> {
  const source = buildSkillImportSource({
    path: options.path,
    url: options.url,
  });

  const result = await importSkill({
    path: source.path,
    url: source.url,
    exposureMode: options.exposure,
  });

  console.log(`Imported skill: ${result.localId}`);
  console.log(`Descriptor: ${join(getManagedAppDir(result.localId), 'aai.json')}`);
  console.log(`Skill directory: ${result.managedPath}`);
  console.log(`Keywords: ${result.descriptor.exposure.keywords.join(', ')}`);
  console.log(`Summary: ${result.descriptor.exposure.summary}`);
}

async function runAppConfig(options: AppConfigOptions): Promise<void> {
  const descriptorPath = join(getManagedAppDir(options.localId), 'aai.json');
  const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf-8')) as AaiJson;

  let nextDescriptor = descriptor;

  if (options.exposure && isMcpAccess(descriptor.access)) {
    const entry = await getMcpRegistryEntry(options.localId);
    if (!entry) {
      throw new Error(`Unknown imported MCP app: ${options.localId}`);
    }

    const refreshed = await refreshImportedMcpServer(
      getMcpExecutor(),
      createSecureStorage(),
      entry,
      options.exposure
    );
    nextDescriptor = refreshed.descriptor;
  } else if (options.exposure && isSkillAccess(descriptor.access)) {
    if (!isSkillPathConfig(descriptor.access.config)) {
      throw new Error(`Imported skill '${options.localId}' is missing a local skill path`);
    }

    const skillContent = readFileSync(join(descriptor.access.config.path, 'SKILL.md'), 'utf-8');
    nextDescriptor = {
      ...descriptor,
      exposure: buildSkillExposure(descriptor.app.name.default, skillContent, options.exposure),
    };
  }

  nextDescriptor = {
    ...nextDescriptor,
    exposure: {
      keywords: options.keywords ?? nextDescriptor.exposure.keywords,
      summary: options.summary ?? nextDescriptor.exposure.summary,
    },
  };

  if (isMcpAccess(nextDescriptor.access)) {
    await upsertMcpRegistryEntry(
      {
        localId: options.localId,
        protocol: 'mcp',
        config: nextDescriptor.access.config,
      },
      nextDescriptor
    );
  } else if (isSkillAccess(nextDescriptor.access)) {
    await upsertSkillRegistryEntry(
      {
        localId: options.localId,
        protocol: 'skill',
        config: nextDescriptor.access.config,
      },
      nextDescriptor
    );
  } else {
    throw new Error(`App '${options.localId}' is not an imported MCP app or imported skill`);
  }

  console.log(`Updated app: ${options.localId}`);
  console.log(`Keywords: ${nextDescriptor.exposure.keywords.join(', ')}`);
  console.log(`Summary: ${nextDescriptor.exposure.summary}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--version')) {
    console.log(VERSION);
    return;
  }

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const options = parseArgs(args);

  switch (options.command) {
    case 'scan':
      await runScan(options.dev);
      return;
    case 'mcp-import':
      await runMcpImport(options);
      return;
    case 'mcp-refresh':
      await runMcpRefresh(options);
      return;
    case 'skill-import':
      await runSkillImport(options);
      return;
    case 'app-config':
      await runAppConfig(options);
      return;
    case 'serve': {
      const server = await createGatewayServer({ devMode: options.dev });
      await server.start();
      return;
    }
  }
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error');
  process.exit(1);
});
