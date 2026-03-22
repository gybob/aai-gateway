import { createGatewayServer } from '../../mcp/server.js';
import type { CommandOptions } from '../../types/index.js';
import { loadAaiConfig } from '../../utils/config.js';

import { BaseCommand } from './interface.js';

/**
 * Serve command
 *
 * Starts the AAI Gateway MCP server
 */
export class ServeCommand extends BaseCommand {
  readonly name = 'serve';
  readonly description = 'Start the AAI Gateway MCP server';

  parse(args: string[]): CommandOptions {
    const dev = args.includes('--dev');
    const host = readStringArg(args, '--host');
    const path = readStringArg(args, '--path');
    const portArg = readStringArg(args, '--port');

    return {
      dev,
      host,
      path,
      port: portArg ? parsePort(portArg) : undefined,
    };
  }

  async execute(options: CommandOptions): Promise<void> {
    this.validate(options);
    const config = loadAaiConfig();
    const server = await createGatewayServer({
      devMode: options.dev as boolean,
      host: (options.host as string | undefined) ?? config.server?.host,
      port: (options.port as number | undefined) ?? config.server?.port,
      path: (options.path as string | undefined) ?? config.server?.path,
    });
    await server.start();
  }
}

function readStringArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('--port must be an integer between 1 and 65535');
  }
  return port;
}
