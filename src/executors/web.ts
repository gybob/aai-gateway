import { AaiError } from '../errors/errors.js';
import type { AaiJson } from '../types/aai-json.js';

/**
 * Auth context for web execution
 */
export interface WebAuthContext {
  /** Auth headers to include in requests */
  headers: Record<string, string>;
  /** Query params to add to URL (for apiKey in query) */
  queryParams?: Record<string, string>;
}

const HTTP_TIMEOUT_MS = 30_000;

/**
 * Execute a web tool
 *
 * @param descriptor - App descriptor
 * @param toolName - Tool to execute
 * @param args - Tool arguments
 * @param authContext - Auth context (from CredentialManager or TokenManager)
 */
export async function executeWebTool(
  descriptor: AaiJson,
  toolName: string,
  args: Record<string, unknown>,
  authContext?: WebAuthContext
): Promise<unknown> {
  const tool = descriptor.tools.find((t) => t.name === toolName);
  if (!tool) {
    throw new AaiError('UNKNOWN_TOOL', `Tool '${toolName}' not found in descriptor`);
  }
  if (!tool.execution) {
    throw new AaiError('INVALID_REQUEST', `Tool '${toolName}' has no HTTP execution config`);
  }

  // Check execution type
  if (descriptor.execution.type !== 'http') {
    throw new AaiError('INVALID_REQUEST', 'Web tool requires http execution type');
  }

  const webExecution = descriptor.execution;
  const baseUrl = webExecution.baseUrl;
  if (!baseUrl) {
    throw new AaiError('INVALID_REQUEST', 'Descriptor missing execution.baseUrl');
  }
  // Build URL with path parameter substitution
  // Create a copy of args to avoid modifying the original
  const processedArgs = { ...args };
  let path = tool.execution.path;
  for (const [key, value] of Object.entries(processedArgs)) {
    const placeholder = `{${key}}`;
    if (path.includes(placeholder)) {
      path = path.replace(placeholder, String(value));
      delete processedArgs[key]; // Remove from args so it doesn't go to body/query
    }
  }


  const url = new URL(`${baseUrl.replace(/\/$/, '')}${path}`);
  const method = tool.execution.method.toUpperCase();

  // Add query params from auth context (for apiKey in query)
  if (authContext?.queryParams) {
    for (const [key, value] of Object.entries(authContext.queryParams)) {
      url.searchParams.set(key, value);
    }
  }

  // Add args as query params for GET requests
  if (method === 'GET') {
    for (const [key, value] of Object.entries(processedArgs)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(webExecution.type === 'http' ? webExecution.defaultHeaders : {}),
    ...authContext?.headers,
    ...tool.execution.headers,
  };

  const isBodyMethod = ['POST', 'PUT', 'PATCH'].includes(method);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: isBodyMethod ? JSON.stringify(processedArgs) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    throw new AaiError('SERVICE_UNAVAILABLE', `HTTP request to ${url} failed: ${String(err)}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const errorCode = httpStatusToErrorCode(res.status);
    let body = '';
    try {
      body = await res.text();
    } catch {
      // ignore
    }
    throw new AaiError(errorCode, `HTTP ${res.status} from ${url.toString()}: ${body}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

function httpStatusToErrorCode(status: number): AaiError['code'] {
  if (status === 400) return 'INVALID_PARAMS';
  if (status === 401) return 'AUTH_REQUIRED';
  if (status === 403) return 'AUTH_DENIED';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVICE_UNAVAILABLE';
  return 'INTERNAL_ERROR';
}
