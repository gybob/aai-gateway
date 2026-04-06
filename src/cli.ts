#!/usr/bin/env node

import { createGatewayServer } from './mcp/server.js';
import { logger } from './utils/logger.js';
import { AAI_GATEWAY_VERSION } from './version.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--version')) {
    console.log(AAI_GATEWAY_VERSION);
    return;
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
AAI Gateway v${AAI_GATEWAY_VERSION}

Usage:
  aai-gateway            Start the MCP server (stdio)
  aai-gateway --version  Show version
  aai-gateway --help     Show help
`);
    return;
  }

  const server = await createGatewayServer();
  await server.start();
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error');
  process.exit(1);
});
