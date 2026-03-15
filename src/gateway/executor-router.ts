import { AaiError } from '../errors/errors.js';
import type { AaiDescriptor, PrimitiveSummary, Runtime, ToolDef } from '../aai/types.js';
import { HttpApiExecutor } from '../executors/http-api-executor.js';
import { IpcExecutor } from '../executors/ipc-executor.js';
import { RpcExecutor } from '../executors/rpc-executor.js';

export class ExecutorRouter {
  constructor(
    private readonly rpcExecutor = new RpcExecutor(),
    private readonly httpApiExecutor = new HttpApiExecutor(),
    private readonly ipcExecutor = new IpcExecutor(),
  ) {}

  async executeTool(
    descriptor: AaiDescriptor,
    runtime: Runtime,
    _summary: PrimitiveSummary,
    tool: ToolDef,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (runtime.kind) {
      case 'rpc':
        return this.rpcExecutor.callTool(
          descriptor,
          runtime,
          tool.binding?.type === 'mcp-tool' ? (tool.binding.toolName ?? tool.name) : tool.name,
          args,
        );
      case 'http-api':
        return this.httpApiExecutor.executeTool(descriptor, runtime, tool, args);
      case 'ipc':
        return this.ipcExecutor.executeTool(runtime, tool, args);
      default:
        throw new AaiError(
          'NOT_IMPLEMENTED',
          `No executor is available for runtime kind '${String((runtime as { kind?: string }).kind)}'`,
        );
    }
  }

  get rpc(): RpcExecutor {
    return this.rpcExecutor;
  }
}
