## 1. Descriptor Core

- [x] 1.1 Replace the current descriptor model with the minimal `app + access + exposure` structure
- [x] 1.2 Update schema validation and type guards for `mcp`, `skill`, `acp-agent`, and `cli`
- [x] 1.3 Remove obsolete execution-model code and parser branches that no longer fit the new design

## 2. Layered Exposure and Discovery

- [x] 2.1 Implement layered exposure so baseline listing returns only `keywords` and `summary`
- [x] 2.2 Refactor authorization and app listing to use only `app.name` and optional `app.iconUrl`
- [x] 2.3 Implement normalized discovery for desktop apps, gateway-managed CLI installs, and web well-known descriptors

## 3. MCP

- [x] 3.1 Refactor MCP integrations to the new descriptor shape
- [x] 3.2 Load MCP third-layer detail lazily from native discovery
- [x] 3.3 Update MCP import and refresh to generate gateway-owned minimal descriptors
- [x] 3.4 Add CLI prompts and optional agent-assisted generation for imported MCP `keywords` and `summary`

## 4. ACP Agent

- [x] 4.1 Refactor ACP integrations so `acp-agent` means an ACP endpoint over stdio
- [x] 4.2 Support both native ACP agents and ACP adapters with the same config shape
- [x] 4.3 Add tests for ACP guide generation, consent, and execution under the layered model

## 5. Skill and CLI

- [x] 5.1 Refactor skill-backed descriptors to support local `path` and remote `url`
- [x] 5.2 Add skill import flow that copies/downloads skills into a gateway-managed local directory and generates descriptors
- [x] 5.3 Add CLI-backed descriptors with minimal command-based config
- [x] 5.4 Add tests for skill and CLI app listing, layered detail loading, consent, execution, and import

## 6. Documentation

- [x] 6.1 Rewrite README around the minimal descriptor and layered exposure model
- [x] 6.2 Document discovery locations for desktop apps, CLI apps, and web apps
- [x] 6.3 Document MCP/skill import flows, including agent-assisted exposure generation
- [x] 6.4 Add end-to-end validation for mixed protocol families in one gateway instance
