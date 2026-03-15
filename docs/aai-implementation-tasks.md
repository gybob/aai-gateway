# AAI 实现任务

本文档分解了按照 [aai-design.md](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/docs/aai-design.md) 重写 `aai-gateway` 所需的实现工作，同时保留当前网关的渐进式披露交互模型。

它涵盖两个主要交付物：

1. 围绕当前 AAI 描述符/运行时模型重写 `aai-gateway`
2. 构建 MCP 到 AAI 的转换/导入工具作为 `aai-gateway` CLI 命令，以便可以导入主流 MCP 服务器配置并按需执行

## 交付状态

本文档描述的重写方案已在当前项目范围内完成。

已交付：

- `src/aai` 下的新规范 AAI 描述符模型
- `src/gateway` 下的以集成为中心的网关运行时
- 围绕 `integration:<id>` 加 `aai:exec` 构建的渐进式披露面
- 托管集成持久化和刷新
- 内置 `import-mcp`、`list-integrations`、`inspect-integration`、`refresh-integration` 和 `remove-integration` CLI 命令
- MCP 传输的 `RpcExecutor`：`stdio`、`streamable-http`、`sse`
- REST 和 GraphQL 绑定的 `HttpApiExecutor`
- `unix-socket` 和 `named-pipe` 的 `IpcExecutor` 参考实现
- 延迟的 `resource-template` URI 展开和执行
- 解析器、存储、导入器、执行器、披露和网关测试

## 历史起点

原始代码库证明了交互模型的价值，但未证明目标运行时架构：

- `tools/list` 暴露轻量级应用条目加上 `web:discover` 和 `aai:exec`
- 执行仍基于旧的 `schemaVersion: "1.0"` 描述符形状
- web、ACP 和原生执行存在于专门路径中
- 基于 `stdio` 的 MCP 执行未实现
- 桌面/web 发现假设应用自带的 `aai.json`，而非转换的 MCP 集成

这意味着重写不是简单的重构。它是模型迁移加运行时替换。

## 目标成果

此工作后：

- `aai-gateway` 使用当前 AAI 描述符形状作为其内部真实来源
- 渐进式披露由协议感知的网关逻辑强制执行
- MCP 服务器可以作为 AAI 集成导入，而非手工编写描述符
- 导入的集成通过通用 `RpcExecutor` 执行
- 即使安装了许多 MCP 集成，模型可见的工具面仍保持精简

## 里程碑 0：基础与迁移策略

### 任务

- 定义代码库内的旧到新迁移边界。
- 决定第一阶段重写是支持临时遗留兼容还是硬切换到新模型。
- 为导入/生成的描述符添加专用的托管集成存储。
- 为导入的集成、运行时和原语引用定义稳定 ID。
- 为描述符缓存、摘要缓存和已解析的原语详情定义缓存目录。

### 交付物

- 内部迁移说明
- 导入集成的托管存储布局
- 稳定 ID 规则

### 验收标准

- 团队可以指向一个规范的内存描述符模型。
- 导入的集成不会与应用自带的描述符冲突。
- 缓存键在重启后保持稳定。

## 里程碑 1：AAI 核心类型与验证

### 任务

- 用设计文档中的新 AAI 类型替换旧的 `src/types/aai-json.ts` 模型。
- 为以下内容添加解析器/验证器支持：
  - `identity`
  - `source`
  - `runtime`
  - `catalog`
  - `auth`
- 为以下内容添加辅助工具：
  - 运行时解析
  - 原语引用解析
  - 摘要与详情检查
  - 协议约定派生值计算
- 添加升级防护，使解析器明确拒绝不支持的描述符版本。

### 交付物

- 新描述符类型定义
- 新解析器和验证层
- 有效和无效描述符的单元测试

### 验收标准

- 运行时不再依赖 v1 字段如 `app`、`execution` 和顶层 `tools`。
- 只有 `catalog.summary` 而没有完整 `snapshot` 的描述符被接受。
- `ref` 身份在 `summary` 和完整原语定义中一致验证。

## 里程碑 2：网关运行时骨架重写

### 任务

- 用以集成为中心的注册表替换当前网关注册表模型。
- 为以下内容引入网关服务：
  - 集成注册表
  - 运行时解析器
  - 原语解析器
  - 披露策略评估器
  - 描述符/详情缓存
- 重构 MCP 服务器入口点以操作新的 AAI 集成对象。
- 保留当前的小工具面策略，而非将每个原语投射到 `tools/list`。

### 交付物

- 新网关服务层
- 新集成注册表抽象
- 更新的 MCP 服务器编排

### 验收标准

- 即使注册了许多集成，`tools/list` 仍保持有界。
- 网关内部解析 `integration -> summary -> primitive detail -> executor`。
- 没有执行路径依赖旧的 v1 工具数组。

## 里程碑 3：渐进式披露引擎

### 任务

- 添加模型面生成器，可以发出：
  - 仅集成条目
  - 集成加摘要列表
  - 临时选定的原语投射
- 使用 `catalog.summary` 实现摘要优先解析。
- 通过 gateway 固定约定添加最大可见项强制执行。
- 添加以 `primitiveRef` 为键的统一执行路径。
- 更新指南生成，使其基于摘要/详情解析而非旧的全描述符转储。

### 交付物

- 披露策略引擎
- 模型面生成器
- 基于 PrimitiveRef 的执行契约

### 验收标准

- 网关从不需要向模型暴露全局完整原语集。
- 选择集成只加载该集成的摘要层。
- 完整 schema 只在执行或最终消歧需要时解析。

## 里程碑 4：MCP/ACP/JSON-RPC 的 RpcExecutor

### 任务

- 构建 `RpcExecutor` 作为以下内容的统一执行器：
  - `protocol = mcp`
  - `protocol = acp`
  - `protocol = jsonrpc`
- 为以下内容实现传输客户端：
  - `stdio`
  - `streamable-http`
  - `sse`
- 实现会话生命周期：
  - 进程生成/复用
  - 远程连接建立
  - initialize 协商
  - 能力捕获
  - 重连/恢复策略（如适用）
- 实现原语操作：
  - `tools/list`
  - `tools/call`
  - `prompts/list`
  - `prompts/get`
  - `resources/list`
  - `resources/read`
  - `resourceTemplates/list`（如果服务器暴露）
- 实现对以下内容的支持：
  - `listChanged`
  - `progress`
  - `tasks`
  - 服务器对 `roots / sampling / elicitation / ping` 的请求

### 交付物

- `RpcExecutor`
- 协议适配器
- 传输客户端
- 会话管理器

### 验收标准

- 导入的 stdio MCP 服务器可以通过 `aai:exec` 风格路由执行。
- 远程 MCP 服务器在配置后可通过 streamable HTTP 或 SSE 工作。
- 网关可以从实时 MCP 列表延迟刷新 `catalog.summary`。

## 里程碑 5：HttpApiExecutor 和 IpcExecutor 迁移

### 任务

- 将现有 web 执行器逻辑移植到新运行时模型。
- 将原生桌面执行移植到 `IpcExecutor`。
- 将旧的应用特定执行代码映射到新的运行时/绑定模型。
- 确保迁移后认证和同意流程仍正常工作。

### 交付物

- `HttpApiExecutor`
- `IpcExecutor`
- 基于新运行时字段的运行时路由

### 验收标准

- 现有 web/原生集成在新模型下仍可执行。
- 执行器路由使用 `runtime.type` 和 `binding` 而非旧的执行分支。

## 里程碑 6：发现与托管集成存储

### 任务

- 将发现拆分为：
  - 应用自带的描述符发现
  - 远程 web 描述符发现
  - 托管导入集成发现
- 在网关拥有的配置/缓存路径下添加托管集成目录。
- 为导入的来源来源添加元数据：
  - 原始 MCP 配置
  - 导入时间戳
  - 转换器版本
  - 来源哈希
- 为导入的集成添加刷新/更新逻辑。

### 交付物

- 托管集成存储
- 导入来源元数据格式
- 统一发现管道

### 验收标准

- 导入的 MCP 集成在重启后作为一等网关集成出现。
- 网关可以通过 `source` 和托管元数据区分应用自带、远程和导入的描述符。

## 里程碑 7：MCP 到 AAI 转换器核心

### 目标

将主流 MCP 服务器配置转换为可被 `aai-gateway` 发现和执行的 AAI 集成。

### 输入范围

转换器应支持这些输入模式：

- 兼容 `"mcpServers"` 风格配置的原始 MCP 服务器对象
- 完整客户端配置文件加选定的服务器名称
- stdio 传输的直接 CLI 标志
- 远程 MCP URL 的直接 CLI 标志

### 首先要支持的主流配置形状

- Claude Desktop 风格的 `mcpServers` JSON
- Cursor 风格的 MCP 服务器配置
- Windsurf 风格的 MCP 服务器配置
- 形如以下通用 JSON 对象：

```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
  "env": {
    "FOO": "bar"
  }
}
```

以及远程风格的输入，如：

```json
{
  "url": "https://example.com/mcp",
  "headers": {
    "Authorization": "Bearer ${TOKEN}"
  }
}
```

### 任务

- 为主流 MCP 客户端配置格式构建配置标准化器。
- 将输入标准化为内部 `ImportedMcpSource` 模型。
- 推断运行时传输：
  - stdio
  - streamable-http
  - sse
- 在可能时运行实时握手：
  - 连接
  - initialize
  - 捕获服务器能力
  - 列出原语
- 生成 AAI 描述符骨架：
  - `identity`
  - `source`
  - `runtime`
  - `catalog.summary`
  - `auth`
- 可选地从实时列表生成或缓存已解析的原语详情。
- 明确标记不确定字段，而非捏造元数据。
- 记录源配置哈希，以便重复导入可以检测漂移。

### 交付物

- 转换器库
- 源标准化器
- 描述符生成器
- 导入元数据格式

### 验收标准

- 主流 stdio MCP 配置可以在无需手工编写描述符的情况下导入。
- 生成的描述符有效且可通过网关执行。
- 网关可以在重启后重新加载导入的集成。

## 里程碑 8：转换器 CLI 命令

### 命令设计

转换器应作为 `aai-gateway` 本身的一部分发布。

推荐命令：

```bash
aai-gateway import-mcp --server-config ./mcp.json --name filesystem
aai-gateway import-mcp --client-config ~/Library/Application\\ Support/Claude/claude_desktop_config.json --server filesystem
aai-gateway import-mcp --command npx --args '-y,@modelcontextprotocol/server-filesystem,/Users/bob'
aai-gateway import-mcp --url https://example.com/mcp
```

可选的后续命令：

```bash
aai-gateway list-integrations
aai-gateway inspect-integration <integration-id>
aai-gateway refresh-integration <integration-id>
aai-gateway remove-integration <integration-id>
```

### CLI 任务

- 将 `src/cli.ts` 扩展为子命令形式。
- 添加 `import-mcp` 命令。
- 添加基于文件的导入模式。
- 添加原始 JSON 导入模式。
- 添加直接 stdio 标志模式。
- 添加远程 MCP URL 导入模式。
- 添加 dry-run 模式。
- 添加仅验证模式。
- 添加覆盖/更新模式。
- 打印生成的集成 ID 和托管描述符位置。

### 验收标准

- 用户可以使用一个命令导入主流 MCP 服务器配置。
- 命令写入托管 AAI 描述符并注册以供网关发现。
- dry-run 模式打印生成的描述符摘要而不修改磁盘。

## 里程碑 9：摘要刷新与延迟详情解析

### 任务

- 为导入的集成添加摘要缓存。
- 按 `primitiveRef` 添加原语详情缓存。
- 在执行路径上添加延迟详情获取。
- 添加刷新触发器：
  - 手动 CLI 刷新
  - TTL 过期
  - `listChanged`
  - 配置时对选定集成的启动预加载
- 确保网关可以在完整详情缓存存在之前使用仅摘要的描述符运行。

### 验收标准

- 即使最初只有摘要数据，导入的集成也可用。
- 首次执行可以自动解析和缓存缺失的详情。

## 里程碑 10：认证、同意与安全迁移

### 任务

- 在可能的情况下将导入的 MCP 认证需求映射到新的认证描述符。
- 在重写期间保留按调用方的同意行为。
- 为导入的远程 MCP 端点添加信任控制。
- 确保导入配置中的密钥安全存储，除非明确允许，否则不写回明文描述符。
- 定义导入配置快照在日志和元数据中的脱敏行为。

### 验收标准

- 导入 MCP 配置默认不会将密钥泄露到日志中。
- 导入的集成与网关的同意模型保持兼容。

## 里程碑 11：兼容性、测试与推出

### 任务

- 为以下内容添加集成测试：
  - stdio MCP 导入和执行
  - 远程 MCP 导入和执行
  - 仅摘要加载后延迟详情获取
  - 重启持久化
  - 导入集成上的同意检查
- 为主流 MCP 客户端添加固定配置。
- 添加从旧内置描述符迁移到新集成的迁移文档。
- 围绕导入成功、握手失败和刷新失败添加遥测/日志。

### 验收标准

- 团队对导入的 MCP 集成有确定性的测试固定装置。
- 失败可以在不阅读原始协议流量的情况下诊断。

## 建议交付顺序

1. 里程碑 0
2. 里程碑 1
3. 里程碑 2
4. 里程碑 3
5. 里程碑 4
6. 里程碑 5
7. 里程碑 6
8. 里程碑 7
9. 里程碑 8
10. 里程碑 9
11. 里程碑 10
12. 里程碑 11

## 建议首次切割范围

如果重写需要更窄的首发版本，使用此范围：

- AAI 核心类型和解析器
- 网关渐进式披露重写
- 仅 stdio MCP 的 `RpcExecutor`
- `import-mcp` 命令，带：
  - 通用 `mcpServers` JSON 对象输入
  - 直接 `--command/--args` 输入
- 生成的 `catalog.summary`
- 通过 `primitiveRef` 的 `aai:exec`

推迟到后续阶段：

- 远程 MCP 导入
- SSE 传输
- prompts/resources 对等
- 更丰富的注册表/服务器卡片来源元数据
- 高级更新/同步命令

## 首次重写的非目标

- 从任意 MCP 服务器完美推断所有发布者/信任元数据
- 自动生成丰富的图标和精美的营销元数据
- 第一天就转换每个非标准的私有 MCP 变体
- 将平台特定的 IPC 驱动作为独立于统一 `IpcExecutor` 的架构分支发布

## 完成定义

此计划在以下情况下完成：

- `aai-gateway` 在内部运行新的 AAI 模型
- 渐进式披露由运行时强制执行，而非仅靠约定
- stdio MCP 导入通过内置 CLI 命令端到端工作
- 导入的集成在本地持久化并自动重新发现
- 导入的 MCP 工具执行通过通用运行时/执行器路径进行
- 即使安装了许多集成，模型可见的工具面仍保持精简

## 任务状态约定

本文档中的任务使用以下状态：

- `已执行`：已经在当前代码库中完成并验证。
- `未执行`：尚未开始实现，后续需要用户确认后再执行。
- `部分执行`：已有基础实现，但还没有完全收敛到当前设计要求。

## 已执行：渐进式披露基础能力

### 状态

`已执行`

### 当前已落地内容

- 小而稳定的模型可见面：`integration:<id>` + `aai:exec`
- 基于 `catalog.summary` 的集成指南生成
- 执行前的按需原语解析
- `resource-template` 的延迟 URI 展开

### 已执行代码点

- [src/gateway/server.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/server.ts)
  - 统一暴露 `integration:<id>` 和 `aai:exec`
  - 执行时按 `primitiveRef` 路由
- [src/gateway/disclosure-engine.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/disclosure-engine.ts)
  - 基于 `catalog.summary` 生成指南
  - 限制可见摘要数量
- [src/gateway/primitive-resolver.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/primitive-resolver.ts)
  - 执行前按需解析完整定义
- [src/shared/uri-template.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/shared/uri-template.ts)
  - 资源模板延迟展开
- 已有测试
  - [src/gateway/disclosure-engine.test.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/disclosure-engine.test.ts)
  - [src/gateway/server.test.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/server.test.ts)

### 说明

这部分是“渐进式披露运行时基础能力”，已经完成。

但协议字段、导入产物和文档口径还没有完全收敛到“最简单层协议 + gateway 运行时约定”的最终形态。


## [未执行] 任务 B：彻底移除 `disclosure` 协议字段，改为协议内建约定

### 目标

不再让作者填写任何 `disclosure` 字段。

渐进式披露直接作为协议约定，由 gateway 统一执行：

- `tools/list` 只暴露集成句柄和统一执行入口
- 优先使用 `catalog.summary`
- 完整定义仅在执行或最终消歧时加载

### 代码变更点

- 更新 [src/aai/types.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/aai/types.ts)
  - 删除 `disclosure` 类型
  - 清理相关的类型注释和导出
- 更新 [src/aai/parser.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/aai/parser.ts)
  - 拒绝 `disclosure` 字段
  - 将渐进式披露相关行为收敛为固定运行时约定
- 新增或更新 [src/aai/derived.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/aai/derived.ts)
  - 输出固定的渐进式披露派生规则
- 更新 [src/gateway/disclosure-engine.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/disclosure-engine.ts)
  - 只依赖单层协议和 gateway 运行时约定
- 更新测试
  - [src/aai/parser.test.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/aai/parser.test.ts)
  - [src/gateway/disclosure-engine.test.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/disclosure-engine.test.ts)

### 验收标准

- 完全不再填写 `disclosure`
- gateway 仍能维持现有渐进式披露行为


## 下一阶段：发现、激活与治理

此阶段使用 [aai-design.md](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/docs/aai-design.md) 中定义的用户操作流程扩展重写后的网关：

- 已安装的本地应用自动发现并默认启用
- 已知的远程应用通过网关拥有的逻辑解析，而非模型猜测
- 未知的远程应用需要用户显式 URL 输入
- 只有已启用的集成暴露在 `tools/list` 中
- 用户可以通过专用控制面检查、启用、禁用、刷新和移除应用

## [未执行] 任务 1：为启用/禁用/网关托管可见性添加集成状态模型

### 目标

引入一等集成状态模型，使网关可以区分：

- 已发现的本地应用
- 已缓存的远程集成
- 对模型可见的已启用集成
- 从 `tools/list` 隐藏的已禁用集成

### 代码变更点

- 更新 [src/aai/types.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/aai/types.ts)
  - 添加集成状态类型，如 `enabled`、`disabledReason`、`origin`、`lastUsedAt`
  - 添加与托管活动集成不同的远程候选类型
- 更新 [src/gateway/managed-store.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/managed-store.ts)
  - 持久化每个集成的启用/禁用状态
  - 支持按状态和来源列出
- 更新 [src/gateway/integration-registry.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/integration-registry.ts)
  - 只为模型面生成加载已启用的集成
  - 暴露单独的注册表查询用于所有集成与已启用集成
- 在 [src/gateway/managed-store.test.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/managed-store.test.ts) 添加测试
  - 覆盖启用/禁用持久化和过滤

### 验收标准

- 网关可以从 `tools/list` 隐藏已禁用的集成而无需删除它们
- 本地和远程集成可以在元数据和查询结果中区分

## [未执行] 任务 2：实现本地已安装应用发现

### 目标

在新架构中重新引入已安装应用发现作为一等能力，默认自动启用。

### 代码变更点

- 添加新的发现模块组
  - [src/gateway/local-discovery.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/local-discovery.ts)
  - 如需要，在 `src/gateway/` 下添加平台特定的辅助工具
- 更新 [src/gateway/integration-registry.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/integration-registry.ts)
  - 将发现的本地应用描述符与托管导入集成合并
- 更新 [src/gateway/server.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/server.ts)
  - 从已启用的本地应用加已启用的托管集成构建 `tools/list`
- 更新 [src/cli.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/cli.ts)
  - 如需要，为本地应用发现添加刷新或重新扫描命令
- 添加测试
  - 新的 [src/gateway/integration-registry.test.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/integration-registry.test.ts)
  - 扩展 [src/gateway/server.test.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/server.test.ts)

### 验收标准

- 已安装的应用在扫描后自动出现
- 已安装的应用默认启用
- 用户仍可以在不卸载的情况下稍后禁用它们

## [未执行] 任务 3：添加远程候选缓存和名称到 URL 解析管道

### 目标

添加网关拥有的解析流程，使模型可以请求 `Notion` 或 `GitHub`，但网关通过缓存和可信元数据解析该名称，而非依赖模型域名猜测。

### 代码变更点

- 添加远程解析服务
  - [src/gateway/remote-resolver.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/remote-resolver.ts)
- 添加远程候选缓存
  - [src/gateway/remote-candidate-store.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/remote-candidate-store.ts)
- 更新 [src/aai/types.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/aai/types.ts)
  - 添加候选元数据、置信度和信任来源字段
- 更新 [src/importer/mcp-importer.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/importer/mcp-importer.ts)
  - 除了原始 CLI 输入外，接受来自已解析远程候选的激活
- 更新 [src/gateway/managed-store.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/managed-store.ts)
  - 持久化成功的 `name -> descriptor URL/domain` 映射以供后续复用
- 添加测试
  - 新的 [src/gateway/remote-resolver.test.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/remote-resolver.test.ts)

### 验收标准

- 网关可以通过缓存或精选元数据解析已知名称
- 未知名称不会以高权威静默猜测域名
- 显式用户提供的 URL 可以缓存以供后续基于名称的复用

## [未执行] 任务 4：添加专用的网关控制工具

### 目标

暴露清晰的管理界面，让用户可以检查和控制可用的应用集。

### 代码变更点

- 更新 [src/gateway/server.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/server.ts)
  - 添加 `aai:config`
  - 可选添加 `aai:resolve-remote`
  - 在 `aai:exec` 上保持正常执行
- 添加配置处理服务
  - [src/gateway/config-controller.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/config-controller.ts)
- 更新 [src/gateway/disclosure-engine.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/disclosure-engine.ts)
  - 使指南生成感知启用/禁用状态（如在配置输出中显示）
- 更新 [src/index.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/index.ts)
  - 如果新的控制服务是公开的，则导出它们
- 添加测试
  - 扩展 [src/gateway/server.test.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/server.test.ts)

### 必需操作

- `listApps`
- `getApp`
- `enableApp`
- `disableApp`
- `refreshApp`
- `removeRemoteCache`
- `pinDomain`

### 验收标准

- 用户可以检查所有已发现的应用，即使它们从 `tools/list` 隐藏
- 用户可以禁用已安装的应用并稍后重新启用
- 用户可以刷新或移除已缓存的远程应用，而无需直接编辑文件

## [未执行] 任务 5：扩展 CLI 用于治理和远程激活

### 目标

为终端用户提供与 MCP 控制面相同的操作。

### 代码变更点

- 更新 [src/cli.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/cli.ts)
  - 添加 `config` 或 `apps` 子命令
  - 添加 `enable-app`、`disable-app`、`resolve-remote`、`pin-domain`
- 更新 [src/importer/mcp-importer.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/importer/mcp-importer.ts)
  - 支持从解析器输出激活
- 更新 [src/gateway/managed-store.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/managed-store.ts)
  - 暴露 CLI 工作流使用的辅助方法
- 添加测试
  - 如添加 CLI 覆盖，新的 [src/cli.test.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/cli.test.ts)

### 验收标准

- 每个控制面操作都有等效的 CLI 路径
- 用户可以从名称或显式 URL 激活远程应用，而无需手动操作存储

## [未执行] 任务 6：保持 `tools/list` 严格限定于已启用的集成

### 目标

即使在添加本地发现和远程缓存后，仍保留渐进式披露优势。

### 代码变更点

- 更新 [src/gateway/server.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/server.ts)
  - 确保 `tools/list` 只使用已启用的集成
  - 将系统工具与应用集成分开暴露
- 更新 [src/gateway/disclosure-engine.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/disclosure-engine.ts)
  - 可选地在有用时为指南标注来源和启用状态
- 更新 [src/gateway/integration-registry.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/integration-registry.ts)
  - 提供快速的仅启用迭代器
- 添加测试
  - 扩展 [src/gateway/server.test.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/server.test.ts)
  - 扩展或添加 [src/gateway/disclosure-engine.test.ts](/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/src/gateway/disclosure-engine.test.ts)

### 验收标准

- 已禁用的应用从不出现在模型可见的应用列表中
- 已缓存但未激活的远程候选从不出现在模型可见的应用列表中
- 即使整个已发现宇宙非常大，控制工具仍保持稳定

## 此阶段的建议交付顺序

1. 任务 1：集成状态模型
2. 任务 2：本地已安装应用发现
3. 任务 6：有界的 `tools/list`
4. 任务 4：网关控制工具
5. 任务 3：远程解析管道
6. 任务 5：CLI 治理和激活
