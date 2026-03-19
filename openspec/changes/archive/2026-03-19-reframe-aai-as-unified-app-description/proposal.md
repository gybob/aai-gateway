## Why

AAI should not be another execution protocol. Its value is to give agents one small, stable descriptor that solves two problems:

- reduce context explosion through layered exposure
- unify app onboarding across heterogeneous protocol families

Detailed capability schemas already belong to the underlying systems:

- MCP exposes tools through native discovery
- skill exposes its own `skill.md`
- ACP defines its own session-based interaction model
- some apps are only reachable as CLIs

This change reframes AAI as a minimal exposure descriptor and moves protocol detail back to the protocol families that already own it.

## What Changes

- **BREAKING** Replace the current descriptor/execution model with a minimal descriptor composed of:
  - `app`
  - `access`
  - `exposure`
- **BREAKING** Remove centralized `tools`, execution `via/transport`, embedded policy, and other protocol-duplicating fields from the AAI descriptor model.
- Introduce a three-layer exposure model in AAI Gateway:
  - Layer 1: `keywords`
  - Layer 2: `summary`
  - Layer 3: protocol-native or protocol-adjacent detail loaded on demand
- Support four access protocol families under one gateway entrypoint:
  - `mcp`
  - `skill`
  - `acp-agent`
  - `cli`
- Add import flows for existing `mcp` and `skill` integrations so the gateway can generate descriptors for user-managed apps.
- Define discovery rules for desktop apps, CLI apps, and web apps.
- Keep user policy such as enable/disable and exposure level in gateway-local configuration rather than in the descriptor.

## Capabilities

### New Capabilities
- `unified-app-description`: Defines the minimal AAI descriptor and the layered exposure model.
- `acp-agent-execution`: Defines how AAI Gateway connects to ACP endpoints over stdio, whether they are native agents or adapters.
- `skill-execution`: Defines how AAI Gateway loads skill-backed apps from local paths or remote URLs.
- `cli-execution`: Defines how AAI Gateway manages CLI-backed apps as a separate protocol family.
- `skill-import`: Defines how AAI Gateway imports skills into a gateway-managed local directory and generates descriptors for them.

### Modified Capabilities
- `mcp-execution`: Reframe MCP execution under the new minimal descriptor and layered exposure model.
- `mcp-import`: Generate minimal AAI descriptors from imported MCP servers, including CLI-driven and optional agent-assisted exposure generation.

## Impact

- Descriptor schema and validation
- Discovery flows for desktop apps, CLI apps, and web apps
- Guide generation and layered exposure
- Executor dispatch for MCP, skill, ACP, and CLI families
- Registry formats for imported MCP apps, imported skills, and locally installed descriptors
- README and protocol-facing docs
