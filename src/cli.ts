#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGatewayServer } from './gateway/server.js';
import type { ImportMcpCliInput } from './importer/mcp-importer.js';
import { McpImporter } from './importer/mcp-importer.js';
import { ManagedIntegrationStore } from './gateway/managed-store.js';
import { logger } from './shared/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')) as {
  version: string;
};

async function main(): Promise<void> {
  const [command = 'serve', ...args] = process.argv.slice(2);

  switch (command) {
    case 'serve':
      await runServe();
      return;
    case 'import-mcp':
      await runImportMcp(args);
      return;
    case 'list-integrations':
      await runListIntegrations();
      return;
    case 'inspect-integration':
      await runInspectIntegration(args[0]);
      return;
    case 'refresh-integration':
      await runRefreshIntegration(args[0]);
      return;
    case 'remove-integration':
      await runRemoveIntegration(args[0]);
      return;
    case '--version':
    case 'version':
      console.log(`aai-gateway v${packageJson.version}`);
      return;
    case '--help':
    case '-h':
    case 'help':
      printHelp();
      return;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

async function runServe(): Promise<void> {
  const gateway = await createGatewayServer();
  await gateway.start();
}

async function runImportMcp(argv: string[]): Promise<void> {
  const input = parseImportArgs(argv);
  const importer = new McpImporter();
  const record = await importer.import(input);

  if (input.dryRun) {
    console.log(JSON.stringify(record.descriptor, null, 2));
    return;
  }

  console.log(`Imported integration: ${record.metadata.integrationId}`);
  console.log(`Stored at: ${new ManagedIntegrationStore().getIntegrationDir(record.metadata.integrationId)}`);
}

async function runListIntegrations(): Promise<void> {
  const store = new ManagedIntegrationStore();
  const records = await store.list();

  if (records.length === 0) {
    console.log('No managed integrations found.');
    return;
  }

  for (const record of records) {
    console.log(record.metadata.integrationId);
    console.log(`  Name: ${record.descriptor.identity.title ?? record.descriptor.identity.id}`);
    console.log(`  Updated: ${record.metadata.updatedAt}`);
    console.log('');
  }
}

async function runInspectIntegration(integrationId?: string): Promise<void> {
  if (!integrationId) {
    console.error('inspect-integration requires <integration-id>');
    process.exit(1);
  }

  const store = new ManagedIntegrationStore();
  const record = await store.get(integrationId);
  if (!record) {
    console.error(`Integration '${integrationId}' not found`);
    process.exit(1);
  }

  console.log(JSON.stringify(record, null, 2));
}

async function runRefreshIntegration(integrationId?: string): Promise<void> {
  if (!integrationId) {
    console.error('refresh-integration requires <integration-id>');
    process.exit(1);
  }

  const importer = new McpImporter();
  const record = await importer.refresh(integrationId);
  console.log(`Refreshed integration: ${record.metadata.integrationId}`);
  console.log(`Updated at: ${record.metadata.updatedAt}`);
}

async function runRemoveIntegration(integrationId?: string): Promise<void> {
  if (!integrationId) {
    console.error('remove-integration requires <integration-id>');
    process.exit(1);
  }

  const store = new ManagedIntegrationStore();
  await store.remove(integrationId);
  console.log(`Removed integration: ${integrationId}`);
}

function parseImportArgs(argv: string[]): ImportMcpCliInput {
  const input: ImportMcpCliInput = {};
  const env: Record<string, string> = {};
  const headers: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--name':
        input.name = next;
        index += 1;
        break;
      case '--integration-id':
        input.integrationId = next;
        index += 1;
        break;
      case '--version':
        input.version = next;
        index += 1;
        break;
      case '--server-config':
        input.serverConfigPath = next;
        index += 1;
        break;
      case '--client-config':
        input.clientConfigPath = next;
        index += 1;
        break;
      case '--server':
        input.serverName = next;
        index += 1;
        break;
      case '--command':
        input.command = next;
        index += 1;
        break;
      case '--args':
        input.args = next ? next.split(',').filter(Boolean) : [];
        index += 1;
        break;
      case '--cwd':
        input.cwd = next;
        index += 1;
        break;
      case '--env':
        if (next) {
          const [key, ...value] = next.split('=');
          if (key && value.length > 0) {
            env[key] = value.join('=');
          }
        }
        index += 1;
        break;
      case '--url':
        input.url = next;
        index += 1;
        break;
      case '--transport':
        if (next === 'streamable-http' || next === 'sse') {
          input.transport = next;
        }
        index += 1;
        break;
      case '--header':
        if (next) {
          const [key, ...value] = next.split('=');
          if (key && value.length > 0) {
            headers[key] = value.join('=');
          }
        }
        index += 1;
        break;
      case '--dry-run':
        input.dryRun = true;
        break;
      default:
        throw new Error(`Unknown import-mcp option: ${arg}`);
    }
  }

  if (Object.keys(env).length > 0) {
    input.env = env;
  }
  if (Object.keys(headers).length > 0) {
    input.headers = headers;
  }

  return input;
}

function printHelp(): void {
  console.log(`
AAI Gateway

Usage:
  aai-gateway serve
  aai-gateway import-mcp [options]
  aai-gateway list-integrations
  aai-gateway inspect-integration <integration-id>
  aai-gateway refresh-integration <integration-id>
  aai-gateway remove-integration <integration-id>

Commands:
  serve
      Start the gateway MCP server over stdio.

  import-mcp
      Import a mainstream MCP server configuration and persist it as a managed AAI integration.

      Supported inputs:
        --command <cmd> --args <comma,separated,args>
        --url <https://example.com/mcp> [--transport streamable-http|sse]
        --server-config <file> [--server <name>]
        --client-config <file> [--server <name>]

      Optional flags:
        --name <display-name>
        --integration-id <stable-id>
        --version <descriptor-version>
        --cwd <working-directory>
        --env KEY=VALUE
        --header KEY=VALUE
        --dry-run

  list-integrations
      List all managed imported integrations.

  inspect-integration <integration-id>
      Print the stored descriptor and metadata for one managed integration.

  refresh-integration <integration-id>
      Reconnect to the original imported MCP source and refresh the cached catalog.

  remove-integration <integration-id>
      Remove a managed imported integration from local storage.
`);
}

main().catch((error) => {
  logger.fatal({ err: error }, 'AAI Gateway CLI failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
