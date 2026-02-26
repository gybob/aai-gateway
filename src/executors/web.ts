import { AaiError } from "../errors/errors.js";
import type { AaiJson } from "../types/aai-json.js";

const HTTP_TIMEOUT_MS = 30_000;

export async function executeWebTool(
  descriptor: AaiJson,
  toolName: string,
  args: Record<string, unknown>,
  accessToken: string
): Promise<unknown> {
  const tool = descriptor.tools.find((t) => t.name === toolName);
  if (!tool) {
    throw new AaiError("UNKNOWN_TOOL", `Tool '${toolName}' not found in descriptor`);
  }
  if (!tool.execution) {
    throw new AaiError(
      "INVALID_REQUEST",
      `Tool '${toolName}' has no HTTP execution config`
    );
  }

  const baseUrl = descriptor.execution.base_url;
  if (!baseUrl) {
    throw new AaiError("INVALID_REQUEST", "Descriptor missing execution.base_url");
  }

  const url = `${baseUrl.replace(/\/$/, "")}${tool.execution.path}`;
  const method = tool.execution.method.toUpperCase();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    ...descriptor.execution.default_headers,
    ...tool.execution.headers,
  };

  const isBodyMethod = ["POST", "PUT", "PATCH"].includes(method);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: isBodyMethod ? JSON.stringify(args) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    throw new AaiError(
      "SERVICE_UNAVAILABLE",
      `HTTP request to ${url} failed: ${String(err)}`
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const errorCode = httpStatusToErrorCode(res.status);
    let body = "";
    try {
      body = await res.text();
    } catch {
      // ignore
    }
    throw new AaiError(errorCode, `HTTP ${res.status} from ${url}: ${body}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return res.text();
}

function httpStatusToErrorCode(status: number): AaiError["code"] {
  if (status === 400) return "INVALID_PARAMS";
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 403) return "AUTH_DENIED";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVICE_UNAVAILABLE";
  return "INTERNAL_ERROR";
}
