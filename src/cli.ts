#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { createDesktopDiscovery } from './discovery/index.js';
import { getMcpExecutor } from './executors/mcp.js';
import {
  generateMcpDescriptor,
  importMcpServer,
  importSkill,
  refreshImportedMcpServer,
  type ExposureDraft,
} from './mcp/importer.js';
import { createGatewayServer } from './mcp/server.js';
import { getMcpRegistryEntry } from './storage/mcp-registry.js';
import { getManagedAppDir } from './storage/paths.js';
import { createSecureStorage } from './storage/secure-storage/index.js';
import type { McpConfig } from './types/aai-json.js';
import { loadAaiConfig } from './utils/config.js';
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
  host?: string;
  port?: number;
  path?: string;
}

interface ScanOptions extends CommonOptions {
  command: 'scan';
}

interface ImportOptionsBase extends CommonOptions {
  localId?: string;
  name?: string;
  keywords: string[];
  summary?: string;
  assistant: boolean;
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

type CliOptions = ServeOptions | ScanOptions | McpImportOptions | McpRefreshOptions | SkillImportOptions;

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
        case '--id':
        case '--name':
        case '--keyword':
        case '--summary':
        case '--assistant':
        case '--dev':
          if (arg !== '--assistant' && arg !== '--dev') i += 1;
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
              '--id',
              '--name',
              '--keyword',
              '--summary',
              '--assistant',
              '--dev',
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
        case '--id':
        case '--name':
        case '--keyword':
        case '--summary':
        case '--assistant':
        case '--dev':
          if (arg !== '--assistant' && arg !== '--dev') i += 1;
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
          if (arg.startsWith('--') && !['--path', '--url'].includes(arg)) {
            throw new Error(`Unknown argument: ${arg}`);
          }
      }
    }
    return { command: 'skill-import', ...base, path, url };
  }

  let host: string | undefined;
  let port: number | undefined;
  let path: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--dev':
        break;
      case '--host':
        host = next;
        i += 1;
        break;
      case '--port':
        port = parsePort(next, '--port');
        i += 1;
        break;
      case '--path':
        path = next;
        i += 1;
        break;
      default:
        if (arg.startsWith('--')) {
          throw new Error(`Unknown argument: ${arg}`);
        }
        break;
    }
  }

  return { command: 'serve', dev, host, port, path };
}

function parseImportBase(args: string[], dev: boolean): ImportOptionsBase {
  const keywords: string[] = [];
  let localId: string | undefined;
  let name: string | undefined;
  let summary: string | undefined;
  let assistant = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--id':
        localId = next;
        i += 1;
        break;
      case '--name':
        name = next;
        i += 1;
        break;
      case '--keyword':
        keywords.push(next);
        i += 1;
        break;
      case '--summary':
        summary = next;
        i += 1;
        break;
      case '--assistant':
        assistant = true;
        break;
      case '--dev':
        break;
      default:
        break;
    }
  }

  return { dev, localId, name, keywords, summary, assistant };
}

function printHelp(): void {
  console.log(`
AAI Gateway

Usage:
  aai-gateway [options]
  aai-gateway mcp import [options]
  aai-gateway mcp refresh <local-id> [options]
  aai-gateway skill import [options]

Options:
  --scan        Scan for desktop descriptors and exit
  --dev         Enable development mode
  --host HOST   Bind streamable HTTP server to host
  --port PORT   Bind streamable HTTP server to port
  --path PATH   Serve MCP streamable HTTP endpoint at path
  --version     Show version
  --help, -h    Show help

Shared import options:
  --id ID                Override generated local ID
  --name NAME            Override display name
  --keyword VALUE        Repeatable exposure keyword
  --summary TEXT         Exposure summary
  --assistant            Accept generated exposure defaults without interactive review

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
`);
}

function buildMcpConfig(options: McpImportOptions): McpConfig {
  if (options.launchCommand) {
    return {
      transport: 'stdio',
      command: options.launchCommand,
      args: options.launchArgs,
      env: Object.keys(options.launchEnv).length > 0 ? options.launchEnv : undefined,
      cwd: options.launchCwd,
    };
  }

  if (options.url) {
    return {
      transport: options.transport ?? 'streamable-http',
      url: options.url,
    };
  }

  throw new Error('MCP import requires either --command or --url');
}

async function ensureExposure(
  draft: ExposureDraft,
  assistant: boolean
): Promise<ExposureDraft> {
  if (assistant || !process.stdin.isTTY || !process.stdout.isTTY) {
    return draft;
  }

  const rl = createInterface({ input, output });
  try {
    const keywordsRaw = await rl.question(
      `Keywords [${draft.keywords.join(', ')}]: `
    );
    const summaryRaw = await rl.question(`Summary [${draft.summary}]: `);

    return {
      keywords:
        keywordsRaw.trim().length > 0
          ? keywordsRaw
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean)
          : draft.keywords,
      summary: summaryRaw.trim().length > 0 ? summaryRaw.trim() : draft.summary,
    };
  } finally {
    rl.close();
  }
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
  const config = buildMcpConfig(options);

  const preview = generateMcpDescriptor(
    {
      localId: options.localId,
      name: options.name,
      config,
      exposure:
        options.summary || options.keywords.length > 0
          ? {
              keywords: options.keywords.length > 0 ? options.keywords : ['mcp'],
              summary: options.summary ?? 'Imported MCP server.',
            }
          : undefined,
    },
    await executor.listTools({
      localId: options.localId ?? 'preview',
      config,
      headers: options.headers,
    })
  );

  const exposure = await ensureExposure(
    {
      keywords:
        options.keywords.length > 0 ? options.keywords : preview.exposure.keywords,
      summary: options.summary ?? preview.exposure.summary,
    },
    options.assistant
  );

  const result = await importMcpServer(executor, storage, {
    localId: options.localId,
    name: options.name,
    config,
    headers: options.headers,
    exposure,
  });

  console.log(`Imported MCP app: ${result.entry.localId}`);
  console.log(`Descriptor: ${result.entry.descriptorPath}`);
  console.log(`Managed directory: ${getManagedAppDir(result.entry.localId)}`);
  console.log(`Keywords: ${result.descriptor.exposure.keywords.join(', ')}`);
}

async function runMcpRefresh(options: McpRefreshOptions): Promise<void> {
  const entry = await getMcpRegistryEntry(options.localId);
  if (!entry) {
    throw new Error(`Unknown imported MCP app: ${options.localId}`);
  }

  const currentDescriptor = JSON.parse(readFileSync(entry.descriptorPath, 'utf-8')) as {
    exposure?: ExposureDraft;
  };

  const exposure = await ensureExposure(
    {
      keywords:
        options.keywords.length > 0 ? options.keywords : currentDescriptor.exposure?.keywords ?? [],
      summary: options.summary ?? currentDescriptor.exposure?.summary ?? 'Imported MCP server.',
    },
    options.assistant
  );

  const result = await refreshImportedMcpServer(
    getMcpExecutor(),
    createSecureStorage(),
    entry,
    exposure
  );

  console.log(`Refreshed MCP app: ${result.entry.localId}`);
  console.log(`Descriptor: ${result.entry.descriptorPath}`);
}

async function runSkillImport(options: SkillImportOptions): Promise<void> {
  if (!options.path && !options.url) {
    throw new Error('Skill import requires either --path or --url');
  }

  const defaultName = options.name ?? (options.path ? options.path.split('/').filter(Boolean).pop() : 'Imported Skill');
  const exposure = await ensureExposure(
    {
      keywords: options.keywords.length > 0 ? options.keywords : ['skill'],
      summary: options.summary ?? `${defaultName} imported into AAI Gateway.`,
    },
    options.assistant
  );

  const result = await importSkill({
    localId: options.localId,
    name: options.name,
    path: options.path,
    url: options.url,
    exposure,
  });

  console.log(`Imported skill: ${result.localId}`);
  console.log(`Descriptor: ${join(getManagedAppDir(result.localId), 'aai.json')}`);
  console.log(`Skill directory: ${result.managedPath}`);
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
    case 'serve': {
      const config = loadAaiConfig();
      const configured = await createGatewayServer({
        devMode: options.dev,
        host: (options as ServeOptions).host ?? config.server?.host,
        port: (options as ServeOptions).port ?? config.server?.port,
        path: (options as ServeOptions).path ?? config.server?.path,
      });
      await configured.start();
      return;
    }
  }
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error');
  process.exit(1);
});

function parsePort(value: string | undefined, flag: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${flag} must be an integer between 1 and 65535`);
  }
  return port;
}
