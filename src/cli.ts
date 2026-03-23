#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createDesktopDiscovery } from './discovery/index.js';
import { getMcpExecutor } from './executors/mcp.js';
import {
  buildMcpImportConfig,
  buildSkillImportSource,
  type ExposureMode,
  EXPOSURE_LIMITS,
  IMPORT_LIMITS,
  importMcpServer,
  importSkill,
  normalizeExposureInput,
  validateImportHeaders,
} from './mcp/importer.js';
import { createGatewayServer } from './mcp/server.js';
import { upsertMcpRegistryEntry } from './storage/mcp-registry.js';
import { getManagedAppDir } from './storage/paths.js';
import { createSecureStorage } from './storage/secure-storage/index.js';
import { upsertSkillRegistryEntry } from './storage/skill-registry.js';
import { isMcpAccess, isSkillAccess, type AaiJson } from './types/aai-json.js';
import { logger } from './utils/logger.js';
import { AAI_GATEWAY_VERSION } from './version.js';

interface CommonOptions {
  dev: boolean;
}

interface ServeOptions extends CommonOptions {
  command: 'serve';
}

interface ScanOptions extends CommonOptions {
  command: 'scan';
}

interface ExposureOptions {
  exposure: ExposureMode;
  summary: string;
  keywords: string[];
}

interface McpImportOptions extends CommonOptions, ExposureOptions {
  command: 'mcp-import';
  transport?: 'streamable-http' | 'sse';
  url?: string;
  launchCommand?: string;
  launchArgs: string[];
  launchEnv: Record<string, string>;
  launchCwd?: string;
  headers: Record<string, string>;
}

interface SkillImportOptions extends CommonOptions, ExposureOptions {
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

type CliOptions = ServeOptions | ScanOptions | McpImportOptions | SkillImportOptions | AppConfigOptions;

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
    const exposure = parseRequiredExposureArgs(args.slice(2));
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
        case '--dev':
          break;
        case '--exposure':
        case '--summary':
        case '--keyword':
          i += 1;
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
          if (
            arg.startsWith('--') &&
            ![
              '--dev',
              '--exposure',
              '--summary',
              '--keyword',
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
      dev,
      ...exposure,
      transport,
      url,
      launchCommand,
      launchArgs,
      launchEnv,
      launchCwd,
      headers,
    };
  }

  if (args[0] === 'skill' && args[1] === 'import') {
    const exposure = parseRequiredExposureArgs(args.slice(2));
    let path: string | undefined;
    let url: string | undefined;
    for (let i = 2; i < args.length; i += 1) {
      const arg = args[i];
      const next = args[i + 1];
      switch (arg) {
        case '--dev':
          break;
        case '--exposure':
        case '--summary':
        case '--keyword':
          i += 1;
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
          if (arg.startsWith('--') && !['--path', '--url', '--dev', '--exposure', '--summary', '--keyword'].includes(arg)) {
            throw new Error(`Unknown argument: ${arg}`);
          }
      }
    }
    return { command: 'skill-import', dev, ...exposure, path, url };
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

function parseRequiredExposureArgs(args: string[]): ExposureOptions {
  let exposure: ExposureMode | undefined;
  let summary: string | undefined;
  const keywords: string[] = [];

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
      case '--summary':
        summary = next;
        i += 1;
        break;
      case '--keyword':
        keywords.push(next);
        i += 1;
        break;
      default:
        break;
    }
  }

  if (!exposure) {
    throw new Error('Import requires --exposure summary|keywords');
  }

  if (!summary) {
    throw new Error(`Import requires --summary (maximum ${EXPOSURE_LIMITS.summaryLength} characters)`);
  }

  if (keywords.length === 0) {
    throw new Error(`Import requires at least one --keyword (maximum ${EXPOSURE_LIMITS.keywordCount} total)`);
  }

  return {
    exposure,
    ...normalizeExposureInput({ keywords, summary }),
  };
}

function printHelp(): void {
  console.log(`
AAI Gateway

Usage:
  aai-gateway [options]
  aai-gateway mcp import [options]
  aai-gateway skill import [options]
  aai-gateway app config <local-id> [options]

Options:
  --scan        Scan for desktop descriptors and exit
  --dev         Enable development mode
  --version     Show version
  --help, -h    Show help

Shared metadata options:
  --exposure MODE        Required for import. One of: summary, keywords
  --summary TEXT         Required for import, max ${EXPOSURE_LIMITS.summaryLength} characters
  --keyword VALUE        Required for import and repeatable, max ${EXPOSURE_LIMITS.keywordCount} items, each max ${EXPOSURE_LIMITS.keywordLength} characters

MCP import options:
  --command CMD          Import a local stdio MCP server, max ${IMPORT_LIMITS.commandLength} chars
  --arg VALUE            Repeatable stdio argument, max ${IMPORT_LIMITS.argCount} items, each max ${IMPORT_LIMITS.argLength} chars
  --env KEY=VALUE        Repeatable stdio environment variable, max ${IMPORT_LIMITS.envCount} entries
  --cwd DIR              Working directory for stdio launch, max ${IMPORT_LIMITS.cwdLength} chars
  --url URL              Import a remote MCP server, max ${IMPORT_LIMITS.urlLength} chars
  --transport TYPE       Remote transport: streamable-http or sse
  --header KEY=VALUE     Repeatable remote header stored in secure storage, max ${IMPORT_LIMITS.headerCount} entries

Skill import options:
  --path DIR             Import a local skill directory, max ${IMPORT_LIMITS.pathLength} chars
  --url URL              Import a remote skill root URL, max ${IMPORT_LIMITS.urlLength} chars

App config options:
  --exposure MODE        Optional. Update the recorded exposure mode
  --summary TEXT         Optional. Override the current summary
  --keyword VALUE        Optional and repeatable. Replace the current keywords
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
  validateImportHeaders(options.headers);
  const config = buildMcpImportConfig({
    transport: options.transport,
    url: options.url,
    command: options.launchCommand,
    args: options.launchArgs,
    env: options.launchEnv,
    cwd: options.launchCwd,
  });

  const result = await importMcpServer(executor, storage, {
    exposureMode: options.exposure,
    keywords: options.keywords,
    summary: options.summary,
    config,
    headers: options.headers,
  });

  console.log(`Imported MCP app: ${result.entry.localId}`);
  console.log(`Descriptor: ${result.entry.descriptorPath}`);
  console.log(`Managed directory: ${getManagedAppDir(result.entry.localId)}`);
  console.log(`Keywords: ${result.descriptor.exposure.keywords.join(', ')}`);
  console.log(`Summary: ${result.descriptor.exposure.summary}`);
  console.log(`Exposure mode: ${options.exposure}`);
}

async function runSkillImport(options: SkillImportOptions): Promise<void> {
  const source = buildSkillImportSource({
    path: options.path,
    url: options.url,
  });

  const result = await importSkill({
    exposureMode: options.exposure,
    keywords: options.keywords,
    summary: options.summary,
    path: source.path,
    url: source.url,
  });

  console.log(`Imported skill: ${result.localId}`);
  console.log(`Descriptor: ${join(getManagedAppDir(result.localId), 'aai.json')}`);
  console.log(`Skill directory: ${result.managedPath}`);
  console.log(`Keywords: ${result.descriptor.exposure.keywords.join(', ')}`);
  console.log(`Summary: ${result.descriptor.exposure.summary}`);
  console.log(`Exposure mode: ${options.exposure}`);
}

async function runAppConfig(options: AppConfigOptions): Promise<void> {
  const descriptorPath = resolveManagedDescriptorPath(options.localId);
  const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf-8')) as AaiJson;

  const nextExposure = normalizeAppConfigExposure(options, descriptor.exposure);
  const nextDescriptor: AaiJson = {
    ...descriptor,
    exposure: nextExposure,
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
  if (options.exposure) {
    console.log(`Exposure mode: ${options.exposure}`);
  }
  console.log(`Keywords: ${nextDescriptor.exposure.keywords.join(', ')}`);
  console.log(`Summary: ${nextDescriptor.exposure.summary}`);
}

function normalizeAppConfigExposure(
  options: AppConfigOptions,
  current: AaiJson['exposure']
): AaiJson['exposure'] {
  const summary = options.summary ?? current.summary;
  const keywords = options.keywords ?? current.keywords;
  return normalizeExposureInput({ keywords, summary });
}

function resolveManagedDescriptorPath(localId: string): string {
  const descriptorPath = join(getManagedAppDir(localId), 'aai.json');
  if (existsSync(descriptorPath)) {
    return descriptorPath;
  }

  return descriptorPath;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--version')) {
    console.log(AAI_GATEWAY_VERSION);
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
