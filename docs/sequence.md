 ```
 @startuml
  title CLI: serve (启动 MCP Server over stdio)

  actor User
  participant "aai-gateway CLI\n(src/cli.ts)" as CLI
  participant "createGatewayServer()\n(src/gateway/server.ts)" as Factory
  participant "AaiGatewayServer" as Gateway
  participant "IntegrationRegistry" as Registry
  participant "ManagedIntegrationStore" as Store
  database "Filesystem\n~/.aai-gateway/integrations" as FS
  participant "AAI parser\nparseAaiDescriptor()" as Parser
  participant "MCP Server SDK\nServer" as MCPServer
  participant "StdioServerTransport" as Stdio

  User -> CLI: run `aai-gateway serve`
  CLI -> Factory: createGatewayServer()
  Factory --> CLI: Gateway
  CLI -> Gateway: start()
  Gateway -> Gateway: initialize()
  Gateway -> Registry: load()
  Registry -> Store: list()
  Store -> FS: mkdir/readdir integrations
  loop each integrationId dir
    Store -> FS: read aai.json + metadata.json
    Store -> Parser: parseAaiDescriptor(JSON)
    Parser --> Store: AaiDescriptor
  end
  Store --> Registry: ManagedIntegrationRecord[]
  Registry --> Gateway: registry ready

  Gateway -> Stdio: new StdioServerTransport()
  Gateway -> MCPServer: connect(Stdio)
  MCPServer --> Gateway: connected

  note over Gateway,MCPServer
  Gateway now handles MCP requests:
  - tools/list
  - tools/call (integration:<id>, aai:exec)
  end note
  @enduml

  ```

  @startuml
  title CLI: import-mcp (导入 MCP 配置 -> 生成 AAI descriptor -> 持久化)

  actor User
  participant "aai-gateway CLI" as CLI
  participant "McpImporter" as Importer
  participant "normalizeImportedMcpSource()" as Normalize
  participant "RpcExecutor" as Rpc
  participant "MCP Client SDK\nClient" as McpClient
  participant "Client Transport\n(stdio/http/sse)" as Transport
  participant "Remote MCP Server" as Remote
  participant "createImportedDescriptor()" as BuildDesc
  participant "ManagedIntegrationStore" as Store
  database "Filesystem\n~/.aai-gateway/integrations/<id>" as FS

  User -> CLI: run `aai-gateway import-mcp ...`
  CLI -> CLI: parseImportArgs(argv)
  CLI -> Importer: import(input)

  Importer -> Normalize: normalizeImportedMcpSource(input)
  Normalize --> Importer: ImportedMcpSource

  Importer -> Rpc: inspectSource(source, runtimeId)
  Rpc -> Rpc: createRuntimeFromSource()
  Rpc -> McpClient: new Client()
  Rpc -> Transport: create transport by source.kind
  Rpc -> McpClient: connect(Transport)
  McpClient -> Remote: MCP initialize/handshake (via transport)

  par list primitives (best-effort safeList)
    McpClient -> Remote: tools/list
    McpClient -> Remote: prompts/list
    McpClient -> Remote: resources/list
    McpClient -> Remote: resourceTemplates/list
  end
  Remote --> McpClient: lists/capabilities
  Rpc -> Transport: close()
  Rpc --> Importer: ImportedPrimitiveCatalog (tools/prompts/resources/templates + capabilities)

  Importer -> BuildDesc: createImportedDescriptor(...catalog, summaries...)
  BuildDesc --> Importer: AaiDescriptor

  alt --dry-run
    Importer --> CLI: descriptor (in record)
    CLI -> User: print JSON descriptor
  else persist
    Importer -> Store: put(descriptor, metadata)
    Store -> FS: mkdir
    Store -> FS: write aai.json
    Store -> FS: write metadata.json
    Store --> Importer: ManagedIntegrationRecord
    Importer --> CLI: record
    CLI -> User: print integrationId + stored path
  end
  @enduml

  @startuml
  title CLI: list-integrations (列出托管集成)

  actor User
  participant "aai-gateway CLI" as CLI
  participant "ManagedIntegrationStore" as Store
  database "Filesystem\n~/.aai-gateway/integrations" as FS
  participant "AAI parser\nparseAaiDescriptor()" as Parser

  User -> CLI: run `aai-gateway list-integrations`
  CLI -> Store: list()
  Store -> FS: mkdir/readdir integrations
  loop each integrationId dir
    Store -> FS: read aai.json + metadata.json
    Store -> Parser: parseAaiDescriptor(JSON)
    Parser --> Store: AaiDescriptor
  end
  Store --> CLI: ManagedIntegrationRecord[]
  CLI -> User: print ids + name + updatedAt
  @enduml

  @startuml
  title CLI: inspect-integration <id> (读取并输出 descriptor+metadata)

  actor User
  participant "aai-gateway CLI" as CLI
  participant "ManagedIntegrationStore" as Store
  database "Filesystem\n~/.aai-gateway/integrations/<id>" as FS
  participant "AAI parser\nparseAaiDescriptor()" as Parser

  User -> CLI: run `aai-gateway inspect-integration <id>`
  CLI -> Store: get(integrationId)
  Store -> FS: read aai.json + metadata.json
  Store -> Parser: parseAaiDescriptor(JSON)
  Parser --> Store: AaiDescriptor
  Store --> CLI: ManagedIntegrationRecord | null

  alt not found
    CLI -> User: print error + exit(1)
  else found
    CLI -> User: print JSON(record)
  end
  @enduml

  @startuml
  title CLI: refresh-integration <id> (用原始 importedMcpSource 重新握手并刷新缓存)

  actor User
  participant "aai-gateway CLI" as CLI
  participant "McpImporter" as Importer
  participant "ManagedIntegrationStore" as Store
  database "Filesystem" as FS
  participant "AAI parser\nparseAaiDescriptor()" as Parser
  participant "RpcExecutor" as Rpc
  participant "Remote MCP Server" as Remote

  User -> CLI: run `aai-gateway refresh-integration <id>`
  CLI -> Importer: refresh(integrationId)

  Importer -> Store: get(integrationId)
  Store -> FS: read aai.json + metadata.json
  Store -> Parser: parseAaiDescriptor(JSON)
  Parser --> Store: AaiDescriptor
  Store --> Importer: record | null

  alt not found
    Importer --> CLI: throw NOT_FOUND
    CLI -> User: print error + exit(1)
  else missing _meta.importedMcpSource
    Importer --> CLI: throw NOT_IMPLEMENTED
    CLI -> User: print error + exit(1)
  else ok
    Importer -> Rpc: inspectSource(importedMcpSource, runtimeId)
    Rpc -> Remote: connect + list primitives
    Remote --> Rpc: updated catalog
    Importer -> Store: put(updated descriptor, preserve importedAt, etc.)
    Store -> FS: write aai.json + metadata.json
    Store --> Importer: refreshed record
    Importer --> CLI: record
    CLI -> User: print refreshed integration + updatedAt
  end
  @enduml

  @startuml
  title CLI: remove-integration <id> (删除托管集成目录)

  actor User
  participant "aai-gateway CLI" as CLI
  participant "ManagedIntegrationStore" as Store
  database "Filesystem\n~/.aai-gateway/integrations/<id>" as FS

  User -> CLI: run `aai-gateway remove-integration <id>`
  CLI -> Store: remove(integrationId)
  Store -> FS: rm -r (force)
  Store --> CLI: ok
  CLI -> User: print removed
  @enduml

  @startuml
  title MCP Server: tools/list (模型可见工具面：integration:<id> + aai:exec)

  actor "Host/Model\n(MCP Client)" as Host
  participant "AaiGatewayServer" as Gateway
  participant "IntegrationRegistry" as Registry

  Host -> Gateway: MCP request tools/list
  Gateway -> Registry: list()
  Registry --> Gateway: ManagedIntegrationRecord[]
  Gateway -> Gateway: listModelTools()\n(build integration:<id> entries)
  Gateway -> Host: MCP response {tools:[integration:*, aai:exec]}
  @enduml

  @startuml
  title MCP Server: tools/call integration:<id> (返回集成指南)

  actor "Host/Model" as Host
  participant "AaiGatewayServer" as Gateway
  participant "IntegrationRegistry" as Registry
  participant "DisclosureEngine" as Disclosure

  Host -> Gateway: tools/call {name="integration:<id>", arguments={}}
  Gateway -> Registry: get(<id>)
  alt integration not found
    Registry --> Gateway: throw NOT_FOUND
    Gateway -> Host: error NOT_FOUND
  else found
    Registry --> Gateway: record
    Gateway -> Disclosure: buildGuide(record.descriptor)
    Disclosure --> Gateway: guide markdown/text
    Gateway -> Host: content[text]=guide
  end
  @enduml

  @startuml
  title MCP Server: tools/call aai:exec (kind=tool) — 含按需刷新与执行器路由

  actor "Host/Model" as Host
  participant "AaiGatewayServer" as Gateway
  participant "IntegrationRegistry" as Registry
  participant "PrimitiveResolver" as Resolver
  participant "ExecutorRouter" as Router
  participant "RpcExecutor" as Rpc
  participant "HttpApiExecutor" as HttpExec
  participant "IpcExecutor" as IpcExec
  participant "Remote MCP Server" as RemoteMcp
  participant "Remote HTTP API" as RemoteHttp
  participant "IPC Service\n(socket)" as RemoteIpc
  participant "ManagedIntegrationStore" as Store
  database "Filesystem" as FS

  Host -> Gateway: tools/call {name="aai:exec", args:{integrationId, primitiveRef, arguments}}
  Gateway -> Registry: get(integrationId)
  Gateway -> Registry: resolveSummary(integrationId, primitiveRef)
  Gateway -> Registry: resolveRuntime(descriptor, summary.runtimeId)

  alt summary.kind != "tool"
    Gateway -> Host: error NOT_IMPLEMENTED (wrong diagram)
  else tool
    Gateway -> Resolver: resolveTool(record, summary)

    alt tool exists in descriptor.catalog.tools.snapshot
      Resolver --> Gateway: ToolDef
    else snapshot missing -> refreshDescriptor()
      Resolver -> Rpc: inspectRuntime(primary runtime)
      Rpc -> RemoteMcp: connect + list primitives
      RemoteMcp --> Rpc: updated catalog
      Resolver -> Store: put(updated descriptor)
      Store -> FS: write aai.json + metadata.json
      Store --> Resolver: refreshed record
      Resolver --> Gateway: ToolDef (from refreshed snapshot)
    end

    Gateway -> Router: executeTool(descriptor, runtime, summary, tool, args)

    alt runtime.kind == "rpc"
      Router -> Rpc: callTool(descriptor, runtime, toolName, args)
      Rpc -> RemoteMcp: tools/call
      RemoteMcp --> Rpc: result
      Rpc --> Router: result
    else runtime.kind == "http-api"
      Router -> HttpExec: executeTool(descriptor, runtime, tool, args)
      HttpExec -> RemoteHttp: fetch (REST/GraphQL)
      RemoteHttp --> HttpExec: response
      HttpExec --> Router: result
    else runtime.kind == "ipc"
      Router -> IpcExec: executeTool(runtime, tool, args)
      IpcExec -> RemoteIpc: connect(path)\nwrite JSON line
      RemoteIpc --> IpcExec: JSON line response
      IpcExec --> Router: result
    end

    Router --> Gateway: result
    Gateway -> Host: content[text]=JSON.stringify(result)
  end
  @enduml

  @startuml
  title MCP Server: tools/call aai:exec (kind=prompt)

  actor "Host/Model" as Host
  participant "AaiGatewayServer" as Gateway
  participant "IntegrationRegistry" as Registry
  participant "PrimitiveResolver" as Resolver
  participant "RpcExecutor" as Rpc
  participant "Remote MCP Server" as Remote

  Host -> Gateway: tools/call aai:exec {integrationId, primitiveRef, arguments}
  Gateway -> Registry: get(integrationId)
  Gateway -> Registry: resolveSummary(integrationId, primitiveRef)
  Gateway -> Registry: resolveRuntime(descriptor, summary.runtimeId)

  alt summary.kind != "prompt"
    Gateway -> Host: error NOT_IMPLEMENTED
  else prompt
    Gateway -> Resolver: resolvePrompt(record, summary)
    Resolver --> Gateway: PromptDef (ensures snapshot exists; may refresh internally)
    Gateway -> Rpc: getPrompt(descriptor, runtime, summary.name, promptArgs<string,string>)
    Rpc -> Remote: prompts/get
    Remote --> Rpc: prompt result
    Rpc --> Gateway: result
    Gateway -> Host: content[text]=result
  end
  @enduml

  @startuml
  title MCP Server: tools/call aai:exec (kind=resource)

  actor "Host/Model" as Host
  participant "AaiGatewayServer" as Gateway
  participant "IntegrationRegistry" as Registry
  participant "PrimitiveResolver" as Resolver
  participant "RpcExecutor" as Rpc
  participant "Remote MCP Server" as Remote

  Host -> Gateway: tools/call aai:exec {integrationId, primitiveRef}
  Gateway -> Registry: get(integrationId)
  Gateway -> Registry: resolveSummary(integrationId, primitiveRef)
  Gateway -> Registry: resolveRuntime(descriptor, summary.runtimeId)

  alt summary.kind != "resource"
    Gateway -> Host: error NOT_IMPLEMENTED
  else resource
    Gateway -> Resolver: resolveResource(record, summary)
    Resolver --> Gateway: ResourceDef (may refresh internally)
    Gateway -> Rpc: readResource(descriptor, runtime, resource.uri)
    Rpc -> Remote: resources/read
    Remote --> Rpc: resource contents
    Rpc --> Gateway: result
    Gateway -> Host: content[text]=result
  end
  @enduml

  @startuml
  title MCP Server: tools/call aai:exec (kind=resource-template) — 延迟 URI 展开

  actor "Host/Model" as Host
  participant "AaiGatewayServer" as Gateway
  participant "IntegrationRegistry" as Registry
  participant "PrimitiveResolver" as Resolver
  participant "UriTemplate\nexpandUriTemplate()" as Uri
  participant "RpcExecutor" as Rpc
  participant "Remote MCP Server" as Remote

  Host -> Gateway: tools/call aai:exec {integrationId, primitiveRef, arguments:vars}
  Gateway -> Registry: get(integrationId)
  Gateway -> Registry: resolveSummary(integrationId, primitiveRef)
  Gateway -> Registry: resolveRuntime(descriptor, summary.runtimeId)

  alt summary.kind != "resource-template"
    Gateway -> Host: error NOT_IMPLEMENTED
  else template
    Gateway -> Resolver: resolveResourceTemplate(record, summary)
    Resolver --> Gateway: ResourceTemplateDef (may refresh internally)

    Gateway -> Uri: expandUriTemplate(uriTemplate, vars)
    Uri --> Gateway: expandedUri

    alt expandedUri still contains "{"
      Gateway -> Host: error INVALID_REQUEST (missing variables)
    else runtime.kind != "rpc"
      Gateway -> Host: error NOT_IMPLEMENTED (requires rpc runtime)
    else ok
      Gateway -> Rpc: readResource(descriptor, runtime, expandedUri)
      Rpc -> Remote: resources/read
      Remote --> Rpc: resource contents
      Rpc --> Gateway: result
      Gateway -> Host: content[text]=result
    end
  end
  @enduml