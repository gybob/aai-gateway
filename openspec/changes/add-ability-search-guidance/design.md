## Context

AAI Gateway already exposes `mcp:import`, `skill:import`, and `import:config`, but it assumes the agent already knows what integration to install. The requested change fills the gap before import: help the agent interpret a user request, search mainstream MCP and skill sources, present a shortlist, and then hand the confirmed items back to the existing import tools.

The main constraint is that this feature must not become a real crawler or package registry inside the gateway. The gateway should stay deterministic and lightweight, while still giving the agent enough structure to do reliable discovery with its own retrieval tools or with a fetch MCP imported through AAI Gateway.

## Goals / Non-Goals

**Goals:**
- Add a new MCP tool that supports search planning, candidate normalization, and install handoff for MCP servers and skills.
- Reuse existing `mcp:import` and `skill:import` flows instead of introducing a second installation path.
- Provide repository presets, query generation, candidate formatting, and confirmation prompts that are consistent across agents.
- Support agents that already have retrieval tools and agents that need a fallback fetch-tool recommendation.

**Non-Goals:**
- Performing live search requests from inside AAI Gateway.
- Building or mirroring a centralized MCP or skill registry.
- Guaranteeing that every candidate can be imported without the agent first reading extra docs or config snippets.
- Adding persistent server-side search sessions or stored search history.

## Decisions

### 1. Use one stateless orchestration tool with phased inputs

The new capability will be exposed as a single MCP tool with three practical phases:
- planning: user request only
- curation: user request plus agent-gathered search evidence
- handoff: curated candidates plus confirmed ids

The tool will stay stateless. Each later phase must include the data needed from the previous phase, rather than relying on a stored server-side session.

Why:
- fits the current server architecture, which mostly handles request/response tools without long-lived import planning state
- avoids cleanup, concurrency, and mismatch issues for temporary search sessions
- makes testing straightforward because each phase is a pure function of input

Alternatives considered:
- Multiple tools such as `search:plan`, `search:curate`, and `search:handoff`
  Rejected because it increases tool surface and forces agents to learn more gateway-specific verbs.
- Persistent search sessions
  Rejected because the value is low relative to the state-management cost.

### 2. Prefer `import:search` as the public tool name

The requested name `ability_search` is understandable but unnatural in English and inconsistent with the gateway's existing tool naming style. The design should implement the feature under `import:search`, because:
- existing gateway tools use colon-scoped names such as `mcp:import` and `import:config`
- the tool is fundamentally about finding things to import
- `ability` is too vague for MCP servers and skills, which are better described as integrations

Alternatives considered:
- `ability_search`
  Rejected as the primary public name because it does not match the current naming style and is semantically weaker.
- `capability_search`
  Rejected because it sounds like searching internal feature descriptions rather than installable integrations.

### 3. Keep a preferred-source policy in code, not a hard allowlist

The tool should use a small built-in set of recommended search targets for the first version. Based on current ecosystem signals, the baseline list should include:
- the official MCP Registry at `github.com/modelcontextprotocol/registry`
- the official MCP servers repository at `github.com/modelcontextprotocol/servers`
- GitHub repository or code search constrained to official orgs, verified orgs, or already-shortlisted high-trust maintainers
- the OpenAI skills catalog at `github.com/openai/skills`

The first version can also include community-curated secondary sources, but they should be labeled as non-authoritative discovery aids rather than primary trust anchors:
- `github.com/punkpeye/awesome-mcp-servers`
- `github.com/ComposioHQ/awesome-claude-skills`

Open skill marketplaces such as ClawHub should not be treated as default high-trust sources. If included at all, they should be placed in a higher-scrutiny tier because they are open publishing surfaces rather than curated upstream catalogs.

These recommendations should live in a dedicated module so responses stay deterministic and unit-testable.

Why:
- avoids introducing remote dependencies or dynamic catalog fetching
- makes it easy to revise source priorities later without redesigning the flow
- lets the gateway steer agents toward safer defaults without pretending the curated list is exhaustive

The response contract should be explicit that these are preferred sources, not the only permissible sources. When the agent goes beyond them, the tool should tell the agent to apply higher scrutiny, such as checking maintainer identity, repository activity, license visibility, README quality, and whether the source exposes importable MCP config or a real skill root.

Alternative considered:
- user-editable or remotely fetched source catalogs
  Rejected for the first cut because it creates a configuration surface before the baseline workflow exists.
- hard-blocking all non-listed sources
  Rejected because the ecosystem is moving quickly and a strict allowlist would make discovery stale and frustrating.

### 4. Normalize candidates from agent-provided evidence

Because the gateway will not search remote sources itself, the tool must accept agent-provided evidence such as repository titles, URLs, snippets, stars, and inferred install hints. The tool will normalize those into a shortlist with:
- a short unique selection id
- integration type
- display name
- source label
- popularity signal
- source URL or install origin
- import handoff hints when available

The selection id should be deterministic from candidate content instead of random. This keeps the flow stateless while still producing compact ids the user can confirm.

Alternative considered:
- random ids stored in gateway memory
  Rejected because it would require temporary server-side state to map later confirmations back to candidates.

### 5. Generate installation handoff, not installation side effects

Once the user confirms one or more ids, the tool will produce a handoff plan for the agent. Each confirmed candidate will be mapped to:
- `mcp:import` with a config snippet when the candidate includes enough MCP config data
- `skill:import` with a local path or remote root URL when the candidate is a skill
- an explicit “inspect docs first” step when the candidate lacks enough import data to call the import tool safely

Why:
- preserves the current import tools as the only place that creates managed integrations
- prevents this feature from becoming a second, partially duplicated install pipeline

### 6. Include fetch fallback guidance as first-class output

If the agent does not have web retrieval, the tool response will include a standard fallback recommendation to import a fetch-style MCP, using the existing `mcp:import` flow and the provided `mcp-fetch-server` example configuration.

Why:
- the search workflow otherwise dead-ends for agents without retrieval
- this leverages a capability the project already supports instead of embedding HTTP fetching in the gateway

## Risks / Trade-offs

- [Candidate quality depends on external search evidence] → Mitigation: make the tool explicit about evidence quality and preserve source URLs so the agent or user can inspect them.
- [Some MCP repositories do not expose import-ready config in search snippets] → Mitigation: allow the handoff plan to require an intermediate doc-reading step before `mcp:import`.
- [Tool naming disagreement] → Mitigation: document the naming choice in README and keep the internal change name decoupled from the final tool name.
- [Built-in source presets can become outdated] → Mitigation: isolate them in one module and cover the response contract with tests so source-list updates are low risk.
- [Agents may drift into low-trust websites] → Mitigation: have the tool return an explicit preferred-source policy and stronger warnings for non-recommended sources.
- [Open marketplaces can contain malicious skills even when they are popular] → Mitigation: keep open marketplaces such as ClawHub out of the default trusted tier and require extra review before surfacing their results.

## Migration Plan

This is an additive change.

1. Register the new MCP tool and route it in `src/mcp/server.ts`.
2. Add a dedicated search-guidance module for argument parsing, source presets, candidate normalization, and response rendering.
3. Add tests for tool listing, planning responses, candidate normalization, confirmation prompts, and import handoff.
4. Update README with the new discovery-before-import workflow, recommended source policy, and fetch fallback guidance.

Rollback is straightforward: remove the tool registration and helper module without touching existing import registries or descriptor formats.

## Open Questions

- Should the first release expose only `import:search`, or keep a temporary alias if downstream prompts already mention `ability_search`?
- How much raw candidate evidence should the tool accept before the input schema becomes too cumbersome for agents to populate?
