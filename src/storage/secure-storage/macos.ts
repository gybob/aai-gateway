import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { SecureStorage } from "./interface.js";

const execFileAsync = promisify(execFile);

const SERVICE = "aai-gateway";

export class MacOSKeychain implements SecureStorage {
  async get(account: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("security", [
        "find-generic-password",
        "-s", SERVICE,
        "-a", account,
        "-w",
      ]);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async set(account: string, value: string): Promise<void> {
    await execFileAsync("security", [
      "add-generic-password",
      "-U",
      "-s", SERVICE,
      "-a", account,
      "-w", value,
    ]);
  }

  async delete(account: string): Promise<void> {
    try {
      await execFileAsync("security", [
        "delete-generic-password",
        "-s", SERVICE,
        "-a", account,
      ]);
    } catch {
      // ignore if not found
    }
  }
}
