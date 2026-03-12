## Context

### 背景

aai-gateway 目前支持三种执行类型：

| 类型          | 通信方式                  | 代表应用                     |
| ------------- | ------------------------- | ---------------------------- |
| Web           | HTTP REST API             | Notion, Feishu               |
| Desktop (IPC) | Apple Events / DBus / COM | macOS/Windows/Linux 原生应用 |
| ACP Agent     | stdio JSON-RPC            | OpenCode, Claude Code        |

CLI-Anything 生成的 CLI 工具使用标准 stdout 输出，支持 `--json` 参数输出结构化数据，这是一种新的执行模式。

### 约束

1. **无外部依赖**：复用 Node.js 内置 `child_process`
2. **与现有架构一致**：复用 `AcpExecutor` 的设计模式
3. **自动发现**：扫描 PATH，无需手动配置

## Goals / Non-Goals

**Goals:**

- 实现通用 CLI 执行器，支持任意符合规范的 CLI 工具
- 自动发现 PATH 中的 `cli-anything-*` 命令
- 支持 `--aai` 参数获取 descriptor，`--json` 参数获取结构化输出
- 与现有 discovery/executor 架构无缝集成

**Non-Goals:**

- 不修改 CLI-Anything 项目（仅提供建议贡献）
- 不支持交互式 CLI（需要 stdin 交互的工具）
- 不管理 CLI 工具的安装/卸载

## Decisions

### 1. CLI 发现机制：扫描 PATH

**决策**：遍历 `$PATH` 环境变量中的目录，查找 `cli-anything-*` 命令

**备选方案**：

| 方案         | 优点                     | 缺点             |
| ------------ | ------------------------ | ---------------- |
| 扫描 PATH    | 完全自动，与安装方式无关 | 启动时扫描开销   |
| 内置命令列表 | 快速                     | 需手动维护       |
| 配置文件注册 | 灵活                     | 增加用户配置负担 |

**理由**：与 ACP Agent 的 `which` 检查机制一致，用户安装后自动发现

### 2. Descriptor 获取：`--aai` 参数

**决策**：CLI 工具通过 `cli-anything-xxx --aai` 输出 aai.json

**格式**：

```json
{
  "schemaVersion": "1.0",
  "app": { "id": "cli-anything.gimp", "name": {...} },
  "execution": {
    "type": "cli",
    "command": "cli-anything-gimp",
    "jsonFlag": "--json"
  },
  "tools": [...]
}
```

**备选方案**：

| 方案                  | 优点               | 缺点       |
| --------------------- | ------------------ | ---------- |
| `--aai` 输出          | 灵活，支持动态生成 | 需执行命令 |
| 内置 descriptor       | 无执行开销         | 需维护同步 |
| 文件路径 `--aai-file` | 避免输出截断       | 增加复杂度 |

**理由**：`--aai` 简单直接，与 `--help`、`--version` 风格一致

### 3. 执行流程

```
Agent 请求 → aai-gateway → CliExecutor.execute(tool, args)
                              │
                              ▼
                    spawn(`${command} ${jsonFlag} ${tool}`, args)
                              │
                              ▼
                    parse stdout as JSON
                              │
                              ▼
                    return result to Agent
```

**关键点**：

- 超时设置：120 秒（与 ACP 一致）
- 错误处理：非零退出码 → 解析 stderr 作为错误信息
- 输出解析：仅解析 stdout，stderr 作为日志

### 4. 类型定义

```typescript
// src/types/aai-json.ts

interface CliExecution {
  type: 'cli';
  command: string; // CLI 命令名
  jsonFlag?: string; // JSON 输出标志，默认 '--json'
  timeout?: number; // 超时毫秒，默认 120000
}
```

## Risks / Trade-offs

### Risk 1: PATH 扫描性能

**风险**：如果 PATH 目录很多或文件很多，启动时扫描可能较慢

**缓解**：

- 并行扫描多个 PATH 目录
- 仅匹配 `cli-anything-*` 前缀，避免 stat 所有文件
- 考虑缓存结果（后续优化）

### Risk 2: CLI 命令不存在

**风险**：用户可能卸载 CLI 但 descriptor 缓存仍存在

**缓解**：

- 每次执行前检查命令是否存在
- 发现阶段缓存 descriptor，执行阶段重新验证

### Risk 3: JSON 解析失败

**风险**：CLI 输出可能不是有效 JSON

**缓解**：

- 捕获解析错误，返回原始输出作为错误信息
- 记录完整 stdout/stderr 用于调试
