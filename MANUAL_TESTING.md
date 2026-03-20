# AAI Gateway 人工测试指南

## 📋 测试目标和范围

### 测试目标

本文档提供 AAI Gateway 项目的详细人工测试指南，确保：

- ✅ 验证所有 Phase 1-3 的功能正常工作
- ✅ 测试新的发现管理器集成
- ✅ 测试统一存储系统
- ✅ 确保向后兼容性
- ✅ 验证错误处理机制
- ✅ 验证跨平台兼容性（macOS、Windows、Linux）

### 测试范围

本文档覆盖以下测试类别：

1. **MCP 服务器启动和连接测试**
2. **发现机制测试**（desktop、agents、managed）
3. **存储系统测试**（registry、cache）
4. **向后兼容性测试**
5. **错误处理测试**
6. **CLI 命令测试**

---

## 🔧 测试环境准备

### 前置条件

在开始测试之前，请确保：

1. **Node.js 环境**
   ```bash
   node --version  # >= 18.0.0
   npm --version
   ```

2. **项目安装**
   ```bash
   cd /Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway
   npm install
   ```

3. **构建项目**
   ```bash
   npm run build
   ```

4. **运行单元测试（确保基础功能正常）**
   ```bash
   npm test
   ```

### 测试环境变量

创建 `.env.test` 文件（可选）：

```bash
# 开发模式
AAI_DEV_MODE=true

# 日志级别
LOG_LEVEL=debug

# 测试目录
TEST_DATA_DIR=/tmp/aai-gateway-test
```

### 测试数据准备

1. **创建测试目录**
   ```bash
   mkdir -p /tmp/aai-gateway-test/apps
   mkdir -p /tmp/aai-gateway-test/registry
   mkdir -p /tmp/aai-gateway-test/logs
   ```

2. **准备测试描述符**
   创建测试用的 AAI 描述符文件，位于 `/tmp/aai-gateway-test/apps/`：

   **mcp-filesystem.json**:
   ```json
   {
     "schemaVersion": "2.0",
     "version": "1.0.0",
     "app": {
       "name": {
         "default": "Filesystem",
         "en": "Filesystem",
         "zh-CN": "文件系统"
       },
       "iconUrl": "https://example.com/icons/filesystem.png"
     },
     "access": {
       "protocol": "mcp",
       "config": {
         "transport": "stdio",
         "command": "npx",
         "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
       }
     },
     "exposure": {
       "keywords": ["files", "local", "filesystem"],
       "summary": "用于读取、写入、列出和搜索本地文件。"
     }
   }
   ```

   **cli-app.json**:
   ```json
   {
     "schemaVersion": "2.0",
     "version": "1.0.0",
     "app": {
       "name": {
         "default": "Test CLI App",
         "en": "Test CLI App",
         "zh-CN": "测试 CLI 应用"
       }
     },
     "access": {
       "protocol": "cli",
       "config": {
         "command": "echo",
         "args": ["Hello"]
       }
     },
     "exposure": {
       "keywords": ["test", "cli"],
       "summary": "测试 CLI 应用。"
     }
   }
   ```

---

## 📝 测试用例

### 1. MCP 服务器启动和连接测试

#### 测试 1.1: 基础启动测试

**测试步骤：**
```bash
# 启动 MCP 服务器
npm run dev

# 或者使用 CLI
./dist/cli.js serve
```

**预期结果：**
- 服务器成功启动
- 控制台输出包含 "MCP server started" 或类似消息
- 无错误信息

**验证点：**
- [ ] 服务器启动无报错
- [ ] 日志输出正常
- [ ] 端口绑定成功（如适用）

---

#### 测试 1.2: 开发模式启动

**测试步骤：**
```bash
./dist/cli.js serve --dev
```

**预期结果：**
- 服务器在开发模式下启动
- 启用额外的调试日志
- 支持热重载（如已实现）

**验证点：**
- [ ] 开发模式标志生效
- [ ] 调试信息更详细
- [ ] 扫描包含开发应用

---

#### 测试 1.3: MCP 客户端连接

**测试步骤：**
1. 配置 MCP 客户端（如 Claude Desktop）：
   ```json
   {
     "mcpServers": {
       "aai-gateway": {
         "command": "node",
         "args": ["/Users/bob/Documents/AIProjects/AgentAppInterface/aai-gateway/dist/index.js"]
       }
     }
   }
   ```

2. 启动 MCP 客户端

**预期结果：**
- 客户端成功连接到 AAI Gateway
- `tools/list` 返回可用工具列表
- 无连接错误

**验证点：**
- [ ] 连接建立成功
- [ ] 工具列表非空
- [ ] 初始化握手完成

---

### 2. 发现机制测试

#### 测试 2.1: DesktopDiscoverySource 扫描

**测试步骤：**
```bash
# 运行扫描命令
./dist/cli.js scan

# 或在代码中测试
# 创建临时描述符文件
mkdir -p ~/.local/share/aai-gateway/apps/test-app
cat > ~/.local/share/aai-gateway/apps/test-app/aai.json << 'EOF'
{
  "schemaVersion": "2.0",
  "version": "1.0.0",
  "app": {
    "name": { "default": "Test App" }
  },
  "access": {
    "protocol": "cli",
    "config": { "command": "echo", "args": ["test"] }
  },
  "exposure": {
    "keywords": ["test"],
    "summary": "Test application"
  }
}
EOF

# 再次扫描
./dist/cli.js scan
```

**预期结果：**
- 扫描到桌面应用（如已安装）
- 扫描到 gateway-managed 应用
- 返回的应用列表包含有效的描述符

**验证点：**
- [ ] 扫描无错误
- [ ] 返回的应用列表非空（或说明无应用）
- [ ] 应用描述符格式正确

---

#### 测试 2.2: AgentDiscoverySource 扫描

**测试步骤：**
```bash
# 扫描 ACP agents
./dist/cli.js scan --dev
```

**预期结果：**
- 发现已注册的 ACP agents
- 描述符格式正确

**验证点：**
- [ ] 发现 OpenCode agent（如已安装）
- [ ] 发现其他 ACP agents（如配置）
- [ ] 描述符包含必要字段

---

#### 测试 2.3: ManagedDiscoverySource 扫描

**测试步骤：**
1. 创建测试应用描述符：
   ```bash
   mkdir -p ~/.local/share/aai-gateway/apps/managed-test
   cat > ~/.local/share/aai-gateway/apps/managed-test/aai.json << 'EOF'
   {
     "schemaVersion": "2.0",
     "version": "1.0.0",
     "app": {
       "name": { "default": "Managed Test" }
     },
     "access": {
       "protocol": "cli",
       "config": { "command": "echo", "args": ["managed"] }
     },
     "exposure": {
       "keywords": ["managed"],
       "summary": "Managed test app"
     }
   }
   EOF
   ```

2. 扫描 managed 应用：
   ```bash
   ./dist/cli.js scan
   ```

**预期结果：**
- 扫描到 gateway-managed 应用
- 返回完整的应用列表

**验证点：**
- [ ] managed-test 应用被扫描到
- [ ] 描述符内容完整
- [ ] 位置路径正确

---

#### 测试 2.4: 发现缓存机制

**测试步骤：**
1. 第一次扫描：
   ```bash
   time ./dist/cli.js scan
   ```

2. 等待 1-2 秒

3. 第二次扫描（应该使用缓存）：
   ```bash
   time ./dist/cli.js scan
   ```

4. 强制刷新：
   ```bash
   ./dist/cli.js scan --refresh
   ```

**预期结果：**
- 第二次扫描速度更快（使用缓存）
- 强制刷新重新扫描所有源
- 缓存 TTL（5分钟）内使用缓存

**验证点：**
- [ ] 第二次扫描明显更快
- [ ] 缓存日志显示 "Using cached discovery results"
- [ ] 强制刷新触发重新扫描

---

#### 测试 2.5: DiscoveryManager 优先级测试

**测试步骤：**
1. 在多个位置创建同名应用描述符
2. 观察扫描结果

**预期结果：**
- 按优先级顺序执行发现源
- Desktop (100) > Agents (90) > Managed (80)
- 高优先级源的结果优先

**验证点：**
- [ ] 发现源按正确顺序执行
- [ ] 优先级逻辑正确
- [ ] 无重复应用（去重）

---

### 3. 存储系统测试

#### 测试 3.1: FileRegistry 基本操作

**测试步骤：**
1. 创建测试脚本 `test-registry.ts`:
   ```typescript
   import { FileRegistry } from './dist/storage/registry.js';
   import type { RegistryItem } from './dist/types/index.js';

   interface TestItem extends RegistryItem {
     name: string;
     value: number;
   }

   const registry = new FileRegistry<TestItem>('/tmp/test-registry.json');

   // 插入项目
   await registry.upsert({
     id: 'test-1',
     updatedAt: new Date().toISOString(),
     name: 'Test Item',
     value: 42
   });

   // 查询项目
   const item = await registry.get('test-1');
   console.log('Retrieved item:', item);

   // 列出所有项目
   const items = await registry.list();
   console.log('All items:', items);

   // 删除项目
   const deleted = await registry.delete('test-1');
   console.log('Deleted:', deleted);
   ```

2. 运行测试：
   ```bash
   node test-registry.ts
   ```

**预期结果：**
- 项目成功插入
- 项目正确查询
- 列表返回所有项目
- 删除操作成功

**验证点：**
- [ ] upsert 操作成功
- [ ] get 返回正确的项目
- [ ] list 返回所有项目
- [ ] delete 操作成功
- [ ] 文件正确持久化到磁盘

---

#### 测试 3.2: FileRegistry 持久化

**测试步骤：**
1. 写入数据到注册表
2. 停止程序
3. 重新创建注册表实例
4. 读取数据

**预期结果：**
- 数据在重启后依然存在
- 文件格式正确

**验证点：**
- [ ] 数据持久化成功
- [ ] 文件可读
- [ ] JSON 格式正确
- [ ] 重启后数据完整

---

#### 测试 3.3: SimpleCache 基本操作

**测试步骤：**
创建测试脚本 `test-cache.ts`:
   ```typescript
   import { SimpleCache } from './dist/storage/cache.js';

   const cache = new SimpleCache<string>(5000); // 5秒 TTL

   // 设置缓存
   cache.set('key1', 'value1');
   cache.set('key2', 'value2', 3000); // 3秒 TTL

   // 读取缓存
   console.log('key1:', cache.get('key1'));
   console.log('key2:', cache.get('key2'));
   console.log('key3:', cache.get('key3')); // null

   // 检查存在性
   console.log('has key1:', cache.has('key1'));

   // 获取大小
   console.log('cache size:', cache.size());

   // 删除缓存
   cache.delete('key1');
   console.log('key1 after delete:', cache.get('key1'));

   // 清空缓存
   cache.clear();
   console.log('size after clear:', cache.size());
   ```

运行测试：
```bash
node test-cache.ts
```

**预期结果：**
- 缓存操作正常
- TTL 过期后返回 null
- 大小统计正确

**验证点：**
- [ ] set/get 操作正确
- [ ] TTL 过期生效
- [ ] has 方法正确
- [ ] size 统计正确
- [ ] delete 操作成功
- [ ] clear 清空所有缓存

---

#### 测试 3.4: Cache 过期机制

**测试步骤：**
1. 设置一个短 TTL 的缓存项（1秒）
2. 立即读取（应该存在）
3. 等待 2 秒
4. 再次读取（应该不存在）

**预期结果：**
- 缓存项在 TTL 过期后自动失效

**验证点：**
- [ ] 初始读取成功
- [ ] 过期后读取返回 null
- [ ] 过期条目被自动清理

---

#### 测试 3.5: MCP Registry

**测试步骤：**
1. 运行 MCP 导入命令：
   ```bash
   ./dist/cli.js mcp import --name "Test MCP" \
     --command npx --arg -y --arg @modelcontextprotocol/server-filesystem --arg /tmp
   ```

2. 列出所有 MCP 服务器：
   ```bash
   ./dist/cli.js mcp list
   ```

3. 获取特定 MCP 服务器：
   ```bash
   ./dist/cli.js mcp get <id>
   ```

4. 删除 MCP 服务器：
   ```bash
   ./dist/cli.js mcp delete <id>
   ```

**预期结果：**
- MCP 服务器成功导入
- 列表包含导入的服务器
- 获取操作返回正确的服务器
- 删除操作成功

**验证点：**
- [ ] 导入操作成功
- [ ] 描述符文件正确创建
- [ ] 列表包含新服务器
- [ ] 获取返回完整信息
- [ ] 删除操作成功

---

#### 测试 3.6: Skill Registry

**测试步骤：**
1. 创建测试技能目录：
   ```bash
   mkdir -p /tmp/test-skill
   echo "# Test Skill" > /tmp/test-skill/SKILL.md
   ```

2. 导入技能：
   ```bash
   ./dist/cli.js skill import --path /tmp/test-skill
   ```

3. 列出所有技能：
   ```bash
   ./dist/cli.js skill list
   ```

4. 删除技能：
   ```bash
   ./dist/cli.js skill delete <id>
   ```

**预期结果：**
- 技能成功导入
- 列表包含导入的技能
- 删除操作成功

**验证点：**
- [ ] 导入操作成功
- [ ] 技能目录正确复制
- [ ] 列表包含新技能
- [ ] 删除操作成功

---

### 4. 向后兼容性测试

#### 测试 4.1: 旧版 API 兼容性

**测试步骤：**
创建测试脚本验证旧版 API 仍然可用：
   ```typescript
   import { createDesktopDiscovery } from './dist/discovery/index.js';

   // 旧版 API 应该仍然工作
   const discovery = createDesktopDiscovery();
   const apps = await discovery.scan({ devMode: true });
   console.log('Found apps:', apps.length);
   ```

**预期结果：**
- 旧版 API 正常工作
- 无破坏性变更

**验证点：**
- [ ] createDesktopDiscovery 可用
- [ ] scan 方法正常工作
- [ ] 返回格式与之前一致

---

#### 测试 4.2: 旧版描述符兼容性

**测试步骤：**
1. 创建旧版格式描述符（schemaVersion 1.0）：
   ```json
   {
     "schemaVersion": "1.0",
     "app": {
       "name": { "default": "Legacy App" }
     },
     "access": {
       "protocol": "mcp",
       "config": {
         "transport": "stdio",
         "command": "npx",
         "args": ["-y", "@modelcontextprotocol/server-filesystem"]
       }
     },
     "exposure": {
       "keywords": ["legacy"],
       "summary": "Legacy app"
     }
   }
   ```

2. 扫描并加载

**预期结果：**
- 旧版描述符仍然可以加载
- 自动转换到新格式（如需要）

**验证点：**
- [ ] 旧版描述符加载成功
- [ ] 无解析错误
- [ ] 应用功能正常

---

#### 测试 4.3: 旧版配置文件兼容性

**测试步骤：**
1. 使用旧版配置格式启动服务器
2. 验证功能正常

**预期结果：**
- 旧版配置仍然有效
- 无配置迁移错误

**验证点：**
- [ ] 配置加载成功
- [ ] 服务器正常启动
- [ ] 功能无异常

---

### 5. 错误处理测试

#### 测试 5.1: 无效描述符处理

**测试步骤：**
1. 创建无效的描述符文件：
   ```json
   {
     "schemaVersion": "2.0",
     "app": {
       // 缺少必需字段
     }
   }
   ```

2. 尝试扫描和加载

**预期结果：**
- 系统优雅地处理错误
- 错误信息清晰
- 不影响其他应用

**验证点：**
- [ ] 错误被捕获
- [ ] 错误日志记录
- [ ] 其他应用正常工作

---

#### 测试 5.2: 不存在的命令处理

**测试步骤：**
创建一个引用不存在的命令的描述符：
   ```json
   {
     "schemaVersion": "2.0",
     "app": {
       "name": { "default": "Bad Command" }
     },
     "access": {
       "protocol": "cli",
       "config": {
         "command": "nonexistent-command-xyz"
       }
     },
     "exposure": {
       "keywords": ["test"],
       "summary": "Test bad command"
     }
   }
   ```

尝试执行

**预期结果：**
- 命令执行失败被正确处理
- 返回清晰的错误信息

**验证点：**
- [ ] 错误被捕获
- [ ] 错误信息包含命令名称
- [ ] 无未捕获异常

---

#### 测试 5.3: 网络错误处理

**测试步骤：**
创建一个远程 MCP 服务器描述符：
   ```json
   {
     "schemaVersion": "2.0",
     "app": {
       "name": { "default": "Remote Server" }
     },
     "access": {
       "protocol": "mcp",
       "config": {
         "transport": "streamable-http",
         "url": "http://localhost:99999/nonexistent"
       }
     },
     "exposure": {
       "keywords": ["remote"],
       "summary": "Test remote server"
     }
   }
   ```

尝试连接

**预期结果：**
- 连接失败被正确处理
- 超时机制生效
- 系统继续运行

**验证点：**
- [ ] 连接错误被捕获
- [ ] 超时机制生效
- [ ] 无系统崩溃

---

#### 测试 5.4: 文件系统错误处理

**测试步骤：**
1. 删除 registry 文件
2. 尝试读写注册表

**预期结果：**
- 系统创建新的注册表
- 无错误抛出

**验证点：**
- [ ] 自动创建缺失文件
- [ ] 注册表正常工作
- [ ] 无数据丢失

---

#### 测试 5.5: 权限错误处理

**测试步骤：**
1. 创建一个只读目录
2. 尝试写入文件

**预期结果：**
- 权限错误被正确处理
- 清晰的错误信息

**验证点：**
- [ ] 权限错误被捕获
- [ ] 错误日志记录
- [ ] 系统继续运行

---

### 6. CLI 命令测试

#### 测试 6.1: help 命令

**测试步骤：**
```bash
./dist/cli.js --help
./dist/cli.js scan --help
./dist/cli.js mcp --help
```

**预期结果：**
- 帮助信息显示正确
- 所有命令都有帮助文档

**验证点：**
- [ ] 帮助信息完整
- [ ] 参数说明清晰
- [ ] 示例正确

---

#### 测试 6.2: scan 命令

**测试步骤：**
```bash
# 基本扫描
./dist/cli.js scan

# 开发模式扫描
./dist/cli.js scan --dev

# 强制刷新
./dist/cli.js scan --refresh

# 输出到文件
./dist/cli.js scan > /tmp/scan-output.json
```

**预期结果：**
- 扫描命令正常执行
- 输出格式正确
- 参数生效

**验证点：**
- [ ] 扫描无错误
- [ ] 输出格式正确
- [ ] --dev 参数生效
- [ ] --refresh 参数生效

---

#### 测试 6.3: mcp 命令

**测试步骤：**
```bash
# 列出 MCP 服务器
./dist/cli.js mcp list

# 获取特定 MCP 服务器
./dist/cli.js mcp get <id>

# 导入 MCP 服务器
./dist/cli.js mcp import --name "Test" --command npx --arg -y --arg @modelcontextprotocol/server-filesystem --arg /tmp

# 刷新 MCP 服务器
./dist/cli.js mcp refresh <id>

# 删除 MCP 服务器
./dist/cli.js mcp delete <id>
```

**预期结果：**
- 所有 MCP 子命令正常工作
- 操作成功执行

**验证点：**
- [ ] list 命令工作
- [ ] get 命令工作
- [ ] import 命令工作
- [ ] refresh 命令工作
- [ ] delete 命令工作

---

#### 测试 6.4: skill 命令

**测试步骤：**
```bash
# 列出技能
./dist/cli.js skill list

# 导入技能
./dist/cli.js skill import --path /tmp/test-skill

# 删除技能
./dist/cli.js skill delete <id>
```

**预期结果：**
- 所有 skill 子命令正常工作

**验证点：**
- [ ] list 命令工作
- [ ] import 命令工作
- [ ] delete 命令工作

---

#### 测试 6.5: 无效参数处理

**测试步骤：**
```bash
./dist/cli.js --invalid-arg
./dist/cli.js scan --invalid-option
./dist/cli.js nonexistent-command
```

**预期结果：**
- 清晰的错误信息
- 建议正确的用法

**验证点：**
- [ ] 错误信息清晰
- [ ] 显示帮助提示
- [ ] 无崩溃

---

## 📊 测试结果记录模板

使用以下模板记录测试结果：

```markdown
## 测试执行记录

### 测试日期
YYYY-MM-DD HH:MM

### 测试环境
- Node.js 版本:
- 操作系统:
- 项目版本:

### 测试结果摘要
- 总测试数: X
- 通过: X
- 失败: X
- 跳过: X

### 详细结果

#### 测试 1.1: 基础启动测试
- 状态: ✅ 通过 / ❌ 失败 / ⏭️ 跳过
- 备注:

#### 测试 1.2: 开发模式启动
- 状态: ✅ 通过 / ❌ 失败 / ⏭️ 跳过
- 备注:

[... 其他测试 ...]

### 发现的问题

#### 问题 1
- 严重程度: 高 / 中 / 低
- 描述:
- 复现步骤:
- 预期行为:
- 实际行为:

[... 其他问题 ...]

### 改进建议

1.
2.
3.
```

---

## 🐛 常见问题和解决方案

### 问题 1: 端口已被占用
**症状:** 启动失败，提示端口已被占用

**解决方案:**
```bash
# 查找占用端口的进程
lsof -i :<port>

# 终止进程或更换端口
```

### 问题 2: 权限错误
**症状:** 无法写入 registry 文件

**解决方案:**
```bash
# 检查目录权限
ls -la ~/.local/share/aai-gateway

# 修复权限
chmod -R 755 ~/.local/share/aai-gateway
```

### 问题 3: 缓存不一致
**症状:** 扫描结果不更新

**解决方案:**
```bash
# 清除缓存并重新扫描
./dist/cli.js scan --refresh
```

---

## 📚 相关文档

- [README.md](./README.md) - 项目概述
- [CHANGELOG.md](./CHANGELOG.md) - 版本变更记录
- [CONTRIBUTING.md](./CONTRIBUTING.md) - 贡献指南

---

## 🤝 反馈和贡献

如果在测试过程中发现问题或有改进建议，请：

1. 记录详细的问题描述和复现步骤
2. 提交 Issue 到 GitHub 仓库
3. 如有修复方案，欢迎提交 Pull Request
