#!/usr/bin/env node

import { createDesktopDiscovery } from './discovery/index.js';
import { createGatewayServer } from './mcp/server.js';
import { createCliCallerContextFromEnv } from './utils/caller-context.js';
import { logger } from './utils/logger.js';
import { AAI_GATEWAY_VERSION } from './version.js';

type CommandName = 'serve' | 'scan' | 'list' | 'guide' | 'exec';

interface ParsedOptions {
  command: CommandName;
  dev: boolean;
  json: boolean;
  app?: string;
  tool?: string;
  argsJson?: string;
}

function parseArgs(args: string[]): ParsedOptions {
  const dev = args.includes('--dev');
  const json = args.includes('--json');

  if (args.includes('--scan')) {
    return { command: 'scan', dev, json };
  }

  const command = normalizeCommand(args[0]);
  if (!command) {
    return { command: 'serve', dev, json };
  }

  let app: string | undefined;
  let tool: string | undefined;
  let argsJson: string | undefined;

  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--dev':
      case '--json':
        break;
      case '--app':
        app = next;
        i += 1;
        break;
      case '--tool':
        tool = next;
        i += 1;
        break;
      case '--args-json':
        argsJson = next;
        i += 1;
        break;
      default:
        if (arg.startsWith('--')) {
          throw new Error(`Unknown argument: ${arg}`);
        }
    }
  }

  return { command, dev, json, app, tool, argsJson };
}

function normalizeCommand(value: string | undefined): CommandName | undefined {
  switch (value) {
    case 'list':
    case 'guide':
    case 'exec':
      return value;
    default:
      return undefined;
  }
}

function printHelp(): void {
  console.log(`
AAI Gateway

Usage:
  aai-gateway [options]
  aai-gateway list [--json]
  aai-gateway guide --app <app-id>
  aai-gateway exec --tool <tool> [--app <app-id>] [--args-json <json>] [--json]

Options:
  --scan        Scan for desktop descriptors and exit
  --dev         Enable development mode
  --json        Print structured JSON when available
  --version     Show version
  --help, -h    Show help
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
    console.log(`${app.appId}`);
    console.log(`  Name: ${app.descriptor.app.name.default}`);
    console.log(`  Location: ${app.location ?? '(unknown)'}`);
    console.log(`  Protocol: ${app.descriptor.access.protocol}`);
    console.log(`  Summary: ${app.descriptor.exposure.summary}`);
  }
}

async function withServer<T>(dev: boolean, fn: (server: Awaited<ReturnType<typeof createGatewayServer>>) => Promise<T>): Promise<T> {
  const server = await createGatewayServer({ devMode: dev });
  await server.initialize();
  return fn(server);
}

async function runList(options: ParsedOptions): Promise<void> {
  const caller = createCliCallerContextFromEnv();
  const tools = await withServer(options.dev, (server) => server.listToolsForCaller(caller));
  if (options.json) {
    console.log(JSON.stringify({ tools }, null, 2));
    return;
  }

  for (const tool of tools) {
    console.log(`${tool.name}`);
    console.log(`  ${tool.description}`);
  }
}

async function runGuide(options: ParsedOptions): Promise<void> {
  if (!options.app) {
    throw new Error('guide requires --app <app-id>');
  }
  const caller = createCliCallerContextFromEnv();
  const guide = await withServer(options.dev, (server) =>
    server.getAppGuideForCaller(stripAppPrefix(options.app!), caller)
  );
  console.log(guide);
}

async function runExec(options: ParsedOptions): Promise<void> {
  if (!options.tool) {
    throw new Error('exec requires --tool <tool>');
  }
  const caller = createCliCallerContextFromEnv();
  const args = parseArgsJson(options.argsJson);
  const result = await withServer(options.dev, (server) =>
    server.executeForCaller(options.app ? stripAppPrefix(options.app) : undefined, options.tool!, args, caller)
  );
  printToolResult(result, options.json);
}

function stripAppPrefix(value: string): string {
  return value.startsWith('app:') ? value.slice(4) : value;
}

function parseArgsJson(value: string | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }

  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--args-json must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function printToolResult(
  result: {
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: Record<string, unknown>;
  },
  json: boolean
): void {
  if (json && result.structuredContent) {
    console.log(JSON.stringify(result.structuredContent, null, 2));
    return;
  }

  const text = result.content
    ?.filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
    .trim();

  if (text && text.length > 0) {
    console.log(text);
    return;
  }

  if (result.structuredContent) {
    console.log(JSON.stringify(result.structuredContent, null, 2));
  }
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
    case 'list':
      await runList(options);
      return;
    case 'guide':
      await runGuide(options);
      return;
    case 'exec':
      await runExec(options);
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
