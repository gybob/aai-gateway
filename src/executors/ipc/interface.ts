export interface IpcExecutor {
  execute(
    appId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown>;
}
