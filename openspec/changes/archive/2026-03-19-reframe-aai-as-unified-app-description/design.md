## Context

AAI Gateway should optimize what the agent sees, not redefine every downstream protocol. The descriptor therefore needs to stay small and stable:

- `app` answers who the user is authorizing
- `access` answers how the gateway connects
- `exposure` answers what the agent sees in layer 1 and layer 2

Layer 3 stays outside the descriptor and is loaded on demand:

- `mcp` -> native MCP discovery
- `skill` -> `SKILL.md` and related assets from a local skill directory or remote skill root
- `acp-agent` -> ACP-native initialization/session metadata
- `cli` -> CLI help and command-level metadata managed by the gateway

AAI Gateway is still early-stage. This change does not preserve compatibility with the previous descriptor model. Code may be rewritten or removed to keep the implementation small and coherent.

User-managed imports are also part of the design:

- imported `mcp` integrations become gateway-owned descriptors
- imported `skill` integrations are copied or downloaded into a gateway-managed local directory
- import flows collect or generate `keywords` and `summary` for the descriptor

## Goals / Non-Goals

**Goals**
- Redefine AAI as a minimal exposure descriptor
- Solve context explosion through layered exposure
- Treat `mcp`, `skill`, `acp-agent`, and `cli` as first-class access families
- Keep user policy local to the gateway
- Support discovery from desktop apps, CLI directories, and web well-known locations
- Support CLI import flows for existing MCP servers and skills

**Non-Goals**
- Making AAI itself an execution protocol
- Mirroring full native capability schemas into AAI
- Preserving legacy descriptor compatibility
- Standardizing every possible CLI interaction shape in this change

## Decisions

1) **AAI is only a minimal descriptor**
- Decision: AAI SHALL contain only `app`, `access`, and `exposure`.
- Rationale: anything more quickly turns AAI back into a second protocol schema.

2) **Layered exposure is the main product value**
- Decision: baseline discovery shows only:
  - layer 1: short `keywords`
  - layer 2: short `summary`
  Layer 3 is loaded only when requested.
- Rationale: this is what actually reduces context pressure.

3) **`app` is display metadata only**
- Decision: `app` SHALL contain:
  - localized names with a required default fallback
  - optional `iconUrl`
- Rationale: the gateway only needs display metadata here for listing and authorization prompts.

4) **`access` identifies the protocol family and its minimal runtime config**
- Decision: `access.protocol` SHALL support:
  - `mcp`
  - `skill`
  - `acp-agent`
  - `cli`
- Decision: each family gets a minimal config shape:
  - `mcp`: transport-specific config
  - `skill`: local skill-directory `path` or remote skill-root `url`
  - `acp-agent`: stdio launch config only
  - `cli`: command launch config only
- Rationale: the descriptor should describe how to connect, not how every downstream protocol works internally.

5) **ACP is modeled as ACP endpoint access, not as generic CLI**
- Decision: `acp-agent` means the target speaks ACP over stdio.
- Decision: it applies equally to:
  - a native ACP agent
  - an ACP adapter wrapping another agent
- Rationale: from the gateway's perspective both are the same integration surface.

6) **CLI is a separate family**
- Decision: `cli` is not a fallback for ACP. It is its own protocol family for apps that are operated as commands.
- Rationale: this keeps ACP clean and lets the gateway support CLI-native apps without pretending they are ACP-compatible.

7) **User policy stays local**
- Decision: enable/disable, exposure level, and per-agent visibility SHALL live in gateway-local configuration, not in the descriptor.
- Rationale: those settings are installation-specific.

8) **Discovery supports three packaging forms**
- Decision:
  - desktop apps may ship descriptors with the app or in app-specific locations that the gateway scans
  - CLI apps and imported assets may be installed into a gateway-managed local directory
  - web apps may publish a descriptor at a well-known URL
- Rationale: unified onboarding is a core part of the gateway.

9) **Desktop apps and gateway-managed installs use different storage assumptions**
- Decision: desktop apps, especially sandboxed macOS apps, SHALL NOT be required to write into the gateway-managed directory.
- Decision: gateway-managed storage is for imported integrations and locally installed CLI-managed assets.
- Rationale: sandboxed apps often cannot write arbitrary shared user directories, while imported assets should remain under gateway control.

10) **Imported integrations become gateway-owned registrations**
- Decision: when a user imports an existing MCP server or skill, the gateway SHALL generate and store its own descriptor.
- Decision: imported skills SHALL be copied or downloaded as full skill directories into a gateway-managed local directory.
- Rationale: imported apps need a stable local registration and a stable execution path.

11) **Exposure metadata may be collected during import**
- Decision: import flows SHALL ensure the generated descriptor has `keywords` and `summary`.
- Decision: the gateway SHOULD support two ways to obtain that metadata:
  - direct user input in the CLI
  - optional agent-assisted generation from upstream/native metadata
- Rationale: imported systems do not always provide concise layer-1 and layer-2 exposure metadata in the desired shape.

12) **All human-facing management commands use the `aai-gateway` CLI**
- Decision: gateway management actions such as import, refresh, and future descriptor management SHALL be exposed under the `aai-gateway ...` CLI namespace.
- Rationale: this keeps the product surface consistent for both users and documentation.

## Risks / Trade-offs

- **CLI ambiguity**: some CLI apps may need more runtime controls later. Mitigation: start with a small config and extend only when a real case demands it.
- **Protocol asymmetry**: Layer 3 detail differs across families. Mitigation: keep AAI focused on exposure, not normalization of every native detail format.
- **Refactor churn**: removing old concepts will require deleting and rewriting code. Mitigation: accept the churn and keep the new model simple.
- **Import quality**: generated summaries may be noisy or vague. Mitigation: allow confirmation and editing during import.

## Implementation Notes

- Do not preserve the old `execution` structure.
- Do not keep deprecated parser branches unless they clearly reduce code.
- Reuse good executor and registry code where it still matches the new model.
- Prefer one direct model over compatibility wrappers.
- Treat imported descriptors as gateway-managed assets.

## Open Questions

- The gateway-managed install root should be:
  - macOS/Linux: `~/.local/share/aai-gateway/apps/`
  - Windows: `%LOCALAPPDATA%/aai-gateway/apps/`
- How much CLI detail should layer 3 expose beyond standard help output?
