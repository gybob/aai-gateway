import { AaiError } from '../errors/errors.js';
import type { AaiDescriptor, Runtime, ToolDef } from '../aai/types.js';

export class HttpApiExecutor {
  async executeTool(
    _descriptor: AaiDescriptor,
    runtime: Runtime,
    tool: ToolDef,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (runtime.transport.type !== 'http') {
      throw new AaiError(
        'INVALID_REQUEST',
        `HttpApiExecutor requires http transport, got '${runtime.transport.type}'`,
      );
    }

    if (!tool.binding || (tool.binding.type !== 'http' && tool.binding.type !== 'graphql')) {
      throw new AaiError(
        'INVALID_REQUEST',
        `Tool '${tool.name}' is not bound to an HTTP or GraphQL operation`,
      );
    }

    if (tool.binding.type === 'graphql') {
      return executeGraphql(runtime.transport.baseUrl, tool.binding.document, args);
    }

    const method = tool.binding.method.toUpperCase();
    const url = new URL(tool.binding.path, ensureTrailingSlash(runtime.transport.baseUrl));
    const headers = {
      'content-type': 'application/json',
      ...(tool.binding.headers ?? {}),
    };

    const requestInit: RequestInit = {
      method,
      headers,
    };

    if (method !== 'GET' && method !== 'HEAD') {
      requestInit.body = JSON.stringify(args);
    } else {
      for (const [key, value] of Object.entries(args)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const response = await fetch(url, requestInit);
    if (!response.ok) {
      throw new AaiError('EXECUTION_ERROR', `HTTP request failed with status ${response.status}`);
    }

    return parseResponse(response);
  }
}

async function executeGraphql(endpoint: string, document: string, variables: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query: document,
      variables,
    }),
  });

  if (!response.ok) {
    throw new AaiError('EXECUTION_ERROR', `GraphQL request failed with status ${response.status}`);
  }

  return parseResponse(response);
}

async function parseResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
