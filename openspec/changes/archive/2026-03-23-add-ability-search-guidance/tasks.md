## 1. MCP Tool Surface

- [x] 1.1 Add the new search-guidance tool to the MCP tool list in `src/mcp/server.ts` with the agreed public name and input schema for planning, curation, and handoff phases
- [x] 1.2 Add request parsing and dispatch logic in `src/mcp/server.ts` so the new tool routes to a dedicated handler without affecting existing `mcp:import`, `skill:import`, or `import:config` flows
- [x] 1.3 Decide and document whether `ability_search` remains an alias or whether `import:search` is the only public tool name

## 2. Search Guidance Core

- [x] 2.1 Create a dedicated module for preferred source policy, query expansion, and response formatting for the search-guidance workflow
- [x] 2.2 Implement the planning phase that turns a user request into normalized intent, search keywords, prioritized source targets, and agent-facing search instructions
- [x] 2.3 Implement the curation phase that normalizes agent-provided search evidence into shortlist candidates with deterministic selection ids, type, source, URL, and popularity fields
- [x] 2.4 Implement the confirmation and handoff phase that validates confirmed ids and maps each selected candidate to `mcp:import`, `skill:import`, or an explicit inspect-docs-first step
- [x] 2.5 Add fallback output for agents without retrieval tooling, including the provided `mcp-fetch-server` import example through the existing MCP import flow
- [x] 2.6 Encode the safety policy for non-recommended sources so the tool warns the agent to avoid arbitrary low-trust websites and apply extra scrutiny outside the preferred list

## 3. Validation And Tests

- [x] 3.1 Add unit tests for query generation, source preset selection, deterministic candidate id generation, and handoff formatting
- [x] 3.2 Extend `src/mcp/server.test.ts` to cover tool listing, planning-only responses, curation responses, confirmation-required responses, and confirmed install handoff responses
- [x] 3.3 Add regression coverage to ensure the new tool does not change existing import behavior for `mcp:import`, `skill:import`, and `import:config`

## 4. Documentation

- [x] 4.1 Update `README.md` in the tool workflow section to document the new discovery-before-import flow and how agents should use the search-guidance tool with existing import tools
- [x] 4.2 Document the preferred source policy in `README.md`, including which mainstream sources are recommended first and why the list is not a strict allowlist
- [x] 4.3 Document the source tiers in `README.md`, distinguishing official catalogs, community-curated GitHub lists, and higher-risk open marketplaces
- [x] 4.4 Document the fallback retrieval path for agents that need to import a fetch MCP before searching remote repositories
- [x] 4.5 Document the final tool naming decision and the expected user confirmation flow for installing one or more candidates
