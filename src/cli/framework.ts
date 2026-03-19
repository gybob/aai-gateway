import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArgumentParser } from './parser.js';
import { registerCommands } from './commands/index.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));
const VERSION = packageJson.version;

/**
 * Print help message
 */
function printHelp(): void {
  const commands = [
    { name: 'serve', description: 'Start the AAI Gateway MCP server' },
    { name: 'scan', description: 'Scan for desktop app descriptors' },
    { name: 'mcp import', description: 'Import an MCP server' },
    { name: 'mcp refresh', description: 'Refresh an imported MCP server' },
    { name: 'skill import', description: 'Import a skill' },
  ];

  console.log(`
AAI Gateway

Usage:
  aai-gateway [options]
  aai-gateway scan [options]
  aai-gateway mcp import [options]
  aai-gateway mcp refresh <local-id> [options]
  aai-gateway skill import [options]

Options:
  --scan        Scan for desktop descriptors and exit
  --dev         Enable development mode
  --version     Show version
  --help, -h    Show help

Commands:
${commands.map(c => `  ${c.name.padEnd(20)} ${c.description}`).join('\n')}

For more information on a specific command, see the documentation.
`);
}

/**
 * Run the CLI
 * @param args - Command line arguments (usually process.argv.slice(2))
 */
export async function runCli(args: string[]): Promise<void> {
  // Check for global options
  if (args.includes('--version')) {
    console.log(VERSION);
    return;
  }

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  // Check for scan command (global flag for backward compatibility)
  if (args.includes('--scan')) {
    const registry = registerCommands(new ArgumentParser());
    const command = registry.get('scan');
    if (command) {
      const options = command.parse(args);
      await command.execute(options);
    }
    return;
  }

  // Determine command
  let commandName = 'serve'; // default command
  if (args[0] && !args[0].startsWith('--')) {
    commandName = args[0];
  }

  // For complex commands (mcp import, etc.), we still use the old parser
  // This will be migrated in later phases
  if (args[0] === 'mcp' || args[0] === 'skill') {
    // Use old CLI logic for now
    // TODO: Phase 2.2 - Migrate all commands to new framework
    logger.info('Using legacy CLI parser for complex commands');
    return; // Will be handled by old cli.ts
  }

  // Use new command framework for simple commands
  const parser = new ArgumentParser();
  const registry = registerCommands(parser);
  const command = registry.get(commandName);

  if (!command) {
    logger.error(`Unknown command: ${commandName}`);
    printHelp();
    process.exit(1);
  }

  try {
    const options = command.parse(args);
    await command.execute(options);
  } catch (err) {
    logger.error({ err }, `Command failed: ${commandName}`);
    throw err;
  }
}
