## Why

CLI-Anything (HKUDS) 是一个将任意软件转换为 Agent 可用 CLI 工具的项目。目前 aai-gateway 支持三种执行类型：Web App (HTTP)、Desktop App (IPC)、ACP Agent (stdio JSON-RPC)，但无法集成 CLI-Anything 生成的 CLI 工具。

CLI 工具是 Agent 最自然的交互方式（结构化输出、无 UI 依赖），集成后将使 aai-gateway 能够访问 CLI-Anything 生成的 11+ 专业软件 CLI（GIMP、Blender、LibreOffice 等），大幅扩展 Agent 的能力边界。

## What Changes

### aai-gateway 端

- 新增 `execution.type: 'cli'` 执行类型
- 新增 `CliExecutor` 执行器，通过子进程执行 CLI 命令并解析 JSON 输出
- 新增 `CliRegistry` 发现器，扫描 PATH 中的 `cli-anything-*` 命令
- CLI 工具通过 `--aai` 参数输出 aai.json descriptor

### CLI-Anything 端（建议贡献）

- Phase 7 (Publish) 生成时，为所有 CLI 添加 `--aai` 命令
- `--aai` 输出符合 AAI Protocol 的 JSON descriptor

## Capabilities

### New Capabilities

- `cli-executor`: CLI 命令执行器，通过子进程执行命令并解析 `--json` 或 `--aai` 输出
- `cli-registry`: CLI 工具发现器，扫描 PATH 中符合命名规范的 CLI 命令并获取其 descriptor

### Modified Capabilities

无（新增能力，不影响现有 spec）

## Impact

### aai-gateway 代码变更

| 文件                            | 变更类型                        |
| ------------------------------- | ------------------------------- |
| `src/types/aai-json.ts`         | 修改 - 添加 `CliExecution` 类型 |
| `src/executors/cli.ts`          | 新增 - CLI 执行器               |
| `src/discovery/cli-registry.ts` | 新增 - CLI 发现器               |
| `src/discovery/index.ts`        | 修改 - 集成 CLI 发现            |
| `src/mcp/server.ts`             | 修改 - 添加 CLI 执行路由        |

### 依赖

- 无新增外部依赖
- 复用现有 `child_process` 模块

### 兼容性

- 向后兼容：现有 Web、IPC、ACP 执行器不受影响
- CLI 工具需支持 `--aai` 参数（CLI-Anything 生成或手动实现）
