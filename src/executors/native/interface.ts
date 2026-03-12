export interface NativeExecutor {
  execute(
    appId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown>;
}
