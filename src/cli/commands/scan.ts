import { BaseCommand } from './interface.js';
import type { CommandOptions } from '../../types/index.js';
import { createDesktopDiscovery } from '../../discovery/index.js';

/**
 * Scan command
 *
 * Scans for desktop app descriptors and prints results
 */
export class ScanCommand extends BaseCommand {
  readonly name = 'scan';
  readonly description = 'Scan for desktop app descriptors';

  parse(args: string[]): CommandOptions {
    const dev = args.includes('--dev');
    return { dev };
  }

  async execute(options: CommandOptions): Promise<void> {
    this.validate(options);

    const discovery = createDesktopDiscovery();
    const apps = await discovery.scan({ devMode: options.dev as boolean });

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
}
