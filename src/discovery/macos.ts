import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseAaiJson } from "../parsers/schema.js";
import { logger } from "../utils/logger.js";
import type { DesktopDiscovery, DiscoveredDesktopApp, DiscoveryOptions } from "./interface.js";

const execAsync = promisify(exec);

/** Standard macOS application directories */
const STANDARD_APP_PATHS = ["/Applications", "~/Applications"];

/** macOS Xcode development build directories */
const XCODE_DEV_PATHS = [
  // Xcode DerivedData - standard location for build products
  "~/Library/Developer/Xcode/DerivedData/*/Build/Products/Debug",
  "~/Library/Developer/Xcode/DerivedData/*/Build/Products/Release",
];
export class MacOSDiscovery implements DesktopDiscovery {
  /**
   * Scan for AAI-enabled desktop applications.
   * @param options - Discovery options
   * @param options.devMode - When true, also scans Xcode development build directories
   */
  async scan(options?: DiscoveryOptions): Promise<DiscoveredDesktopApp[]> {
    const searchPaths = [...STANDARD_APP_PATHS];

    // Add development paths if devMode is enabled
    if (options?.devMode) {
      searchPaths.push(...XCODE_DEV_PATHS);
      logger.info("Development mode enabled - scanning Xcode build directories");
    }

    // Build find command: paths go directly as find arguments, ~ needs shell expansion
    // Use zsh nullglob to handle non-matching globs silently
    const pathsArg = searchPaths.join(" ");
    const findCmd = `setopt nullglob 2>/dev/null; find ${pathsArg} -maxdepth 4 -path "*/Contents/Resources/aai.json" 2>/dev/null`;

    let stdout: string;
    try {
      const result = await execAsync(findCmd, { shell: "/bin/zsh" });
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
