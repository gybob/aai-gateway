import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { AaiError } from "../../errors/errors.js";
import type { IpcExecutor } from "./interface.js";

const execFileAsync = promisify(execFile);

const IPC_TIMEOUT_MS = 30_000;

interface IpcRequest {
  version: "1.0";
  tool: string;
  params: Record<string, unknown>;
  request_id: string;
}

interface IpcResponse {
  version: "1.0";
  request_id: string;
  status: "success" | "error";
  result?: unknown;
  error?: { code: string; message: string };
}

export class MacOSIpcExecutor implements IpcExecutor {
  async execute(
    appId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const request: IpcRequest = {
      version: "1.0",
      tool: toolName,
      params: args,
      request_id: randomUUID(),
    };

    const jsonStr = JSON.stringify(request).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    const script = `tell application id "${appId}"
  «event AAI call» given «class kfil»:"${jsonStr}"
end tell`;

    let stdout: string;
    try {
      const timer = setTimeout(() => {}, IPC_TIMEOUT_MS);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), IPC_TIMEOUT_MS);
      try {
        ({ stdout } = await execFileAsync("osascript", ["-e", script]));
      } finally {
        clearTimeout(timeoutId);
      }
      clearTimeout(timer);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "ABORT_ERR") {
        throw new AaiError("TIMEOUT", `IPC call to ${appId}/${toolName} timed out`);
      }
      throw new AaiError(
        "INTERNAL_ERROR",
        `Apple Events call failed for ${appId}/${toolName}: ${String(err)}`
      );
    }

    let response: IpcResponse;
    try {
      response = JSON.parse(stdout.trim()) as IpcResponse;
    } catch {
      throw new AaiError(
        "INTERNAL_ERROR",
        `Invalid JSON response from ${appId}/${toolName}: ${stdout}`
      );
    }

    if (response.status === "error") {
      const code = response.error?.code ?? "INTERNAL_ERROR";
      const msg = response.error?.message ?? "Unknown IPC error";
      throw new AaiError("INTERNAL_ERROR", `${appId}/${toolName} error [${code}]: ${msg}`);
    }

    return response.result;
  }
}
