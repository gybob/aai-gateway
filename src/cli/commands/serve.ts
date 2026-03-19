import { BaseCommand } from './interface.js';
import type { CommandOptions } from '../../types/index.js';
import { createGatewayServer } from '../../mcp/server.js';

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
    return { dev };
  }

  async execute(options: CommandOptions): Promise<void> {
    this.validate(options);

    const server = await createGatewayServer({ devMode: options.dev as boolean });
    await server.start();
  }
}
