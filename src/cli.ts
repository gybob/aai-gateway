#!/usr/bin/env node

import { createGatewayServer } from "./mcp/server.js";
import { createDesktopDiscovery } from "./discovery/index.js";
import { logger } from "./utils/logger.js";

const VERSION = "0.1.0";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
AAI Gateway - Agent App Interface Protocol Gateway

Usage:
  aai-gateway [options]

Options:
  --scan        Scan for AAI-enabled desktop apps and exit
  --version     Show version
  --help, -h    Show this help message

Environment Variables:
  AAI_LOG_LEVEL   Log level (debug, info, warn, error)

Default mode starts an MCP server over stdio.
`);
    process.exit(0);
  }

  if (args.includes("--version")) {
    console.log(`aai-gateway v${VERSION}`);
    process.exit(0);
  }

  if (args.includes("--scan")) {
    try {
      const discovery = createDesktopDiscovery();
      const apps = await discovery.scan();

      console.log("\nDiscovered AAI-enabled Applications:");
      console.log("=====================================\n");

      if (apps.length === 0) {
        console.log("No applications found.");
        console.log(
          "Apps must ship /Applications/<Name>.app/Contents/Resources/aai.json"
        );
      } else {
        for (const app of apps) {
          console.log(`  ${app.appId}`);
          console.log(`    Name: ${app.name}`);
          console.log(`    Bundle: ${app.bundlePath}`);
          console.log(`    Description: ${app.description}`);
          console.log("");
        }
        console.log(`Total: ${apps.length} application(s)`);
      }
    } catch (err) {
      console.error("Scan failed:", err);
      process.exit(1);
    }
    process.exit(0);
  }

  // Default: start MCP server
  try {
    const gateway = await createGatewayServer();
    await gateway.start();
  } catch (err) {
    logger.fatal({ err }, "Failed to start AAI Gateway");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
