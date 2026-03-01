#!/usr/bin/env node

import { createGatewayServer } from './mcp/server.js';
import { createDesktopDiscovery } from './discovery/index.js';
import { logger } from './utils/logger.js';

const VERSION = '0.2.0';

interface CliOptions {
  scan: boolean;
  dev: boolean;
  version: boolean;
  help: boolean;
}

function parseArgs(args: string[]): CliOptions {
  return {
    scan: args.includes('--scan'),
    dev: args.includes('--dev'),
    version: args.includes('--version'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    console.log(`
AAI Gateway - Agent App Interface Protocol Gateway

Usage:
  aai-gateway [options]

Options:
  --scan        Scan for AAI-enabled desktop apps and exit
  --dev         Enable development mode (scan Xcode build directories)
  --version     Show version
  --help, -h    Show this help message

Environment Variables:
  AAI_LOG_LEVEL   Log level (debug, info, warn, error)

Development Mode:
  When --dev is used with --scan or MCP server, the gateway will also scan
  Xcode build directories for apps in development:
    ~/Library/Developer/Xcode/DerivedData/*/Build/Products/Debug
    ~/Library/Developer/Xcode/DerivedData/*/Build/Products/Release

Default mode starts an MCP server over stdio.
`);
    process.exit(0);
  }

  if (options.version) {
    console.log(`aai-gateway v${VERSION}`);
    process.exit(0);
  }

  if (options.scan) {
    try {
      const discovery = createDesktopDiscovery();
      const apps = await discovery.scan({ devMode: options.dev });

      console.log('\nDiscovered AAI-enabled Applications:');
      console.log('=====================================\n');

      if (apps.length === 0) {
        console.log('No applications found.');
        if (options.dev) {
          console.log('Apps must ship /Applications/<Name>.app/Contents/Resources/aai.json');
          console.log(
            'Or in Xcode build: ~/Library/Developer/Xcode/DerivedData/*/Build/Products/Debug/<Name>.app/Contents/Resources/aai.json'
          );
        } else {
          console.log('Apps must ship /Applications/<Name>.app/Contents/Resources/aai.json');
          console.log('Tip: Use --dev to also scan Xcode build directories.');
        }
      } else {
        for (const app of apps) {
          console.log(`  ${app.appId}`);
          console.log(`    Name: ${app.name}`);
          console.log(`    Bundle: ${app.bundlePath}`);
          console.log(`    Description: ${app.description}`);
          console.log('');
        }
        console.log(`Total: ${apps.length} application(s)`);
        if (options.dev) {
          console.log('(Development mode: scanned Xcode build directories)');
        }
      }
    } catch (err) {
      console.error('Scan failed:', err);
      process.exit(1);
    }
    process.exit(0);
  }

  // Default: start MCP server
  try {
    const gateway = await createGatewayServer({ devMode: options.dev });
    await gateway.start();
  } catch (err) {
    logger.fatal({ err }, 'Failed to start AAI Gateway');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
