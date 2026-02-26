import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseAaiJson } from "../parsers/schema.js";
import { logger } from "../utils/logger.js";
import type { DesktopDiscovery, DiscoveredDesktopApp } from "./interface.js";

const execAsync = promisify(exec);

export class MacOSDiscovery implements DesktopDiscovery {
  async scan(): Promise<DiscoveredDesktopApp[]> {
    let stdout: string;
    try {
      const result = await execAsync(
        'find /Applications ~/Applications -maxdepth 4 -path "*/Contents/Resources/aai.json" 2>/dev/null',
        { shell: "/bin/zsh" }
      );
      stdout = result.stdout;
    } catch (err: unknown) {
      // find exits non-zero if some dirs are inaccessible; stdout still has results
      stdout = (err as { stdout?: string }).stdout ?? "";
    }

    const paths = stdout
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);

    const apps: DiscoveredDesktopApp[] = [];

    for (const aaiJsonPath of paths) {
      try {
        const raw = await readFile(aaiJsonPath, "utf-8");
        const descriptor = parseAaiJson(JSON.parse(raw));

        if (descriptor.platform !== "macos") continue;

        // bundlePath: go up from Contents/Resources/aai.json → .app dir
        // aaiJsonPath = /Applications/Foo.app/Contents/Resources/aai.json
        const bundlePath = dirname(dirname(dirname(aaiJsonPath)));

        apps.push({
          bundlePath,
          appId: descriptor.app.id,
          name: descriptor.app.name,
          description: descriptor.app.description,
          descriptor,
        });
      } catch (err) {
        logger.warn({ path: aaiJsonPath, err }, "Failed to parse aai.json");
      }
    }

    return apps;
  }
}
