## ADDED Requirements

### Requirement: AAI Gateway exposes a search-guidance tool for import discovery
AAI Gateway SHALL expose a search-guidance tool that helps an agent turn a natural-language user request into:
- a normalized installation intent
- search keywords and alternate query phrases
- prioritized MCP and skill discovery sources
- instructions for how the agent should search those sources

The tool SHALL guide discovery for importable integrations without executing the external search itself.

#### Scenario: Agent asks for a search plan
- **WHEN** the agent calls the search-guidance tool with a user request but no gathered search evidence
- **THEN** the gateway returns source guidance, query guidance, and next-step instructions instead of pretending that a live search has already been performed

### Requirement: Search guidance can normalize externally gathered candidates
The search-guidance tool SHALL accept agent-provided search evidence and convert it into a candidate shortlist for user review.

Each candidate in the shortlist SHALL include:
- a temporary selection id unique within the response
- a display name
- a source label
- a source URL or install origin
- an integration type of `mcp` or `skill`
- a popularity signal such as stars when available

#### Scenario: Agent provides retrieved search evidence
- **WHEN** the agent supplies repository or registry search evidence to the search-guidance tool
- **THEN** the gateway returns a normalized shortlist of candidate MCP servers and skills with temporary selection ids and comparable popularity information

### Requirement: Search guidance recommends trusted discovery sources without hard-blocking all others
The search-guidance tool SHALL return a preferred source policy that prioritizes mainstream, high-trust discovery sources.

The preferred source policy SHALL:
- recommend official MCP ecosystem sources before general web search
- recommend major public code hosts and official vendor catalogs for skills
- allow community-curated lists as secondary discovery sources
- state that the recommended list is preferred but not exhaustive
- instruct the agent to avoid arbitrary low-trust sources
- require extra scrutiny before suggesting candidates from non-recommended sources
- treat open publishing marketplaces as higher-risk than official catalogs or curated GitHub lists

#### Scenario: Agent requests source guidance
- **WHEN** the agent asks the search-guidance tool where it should search
- **THEN** the gateway returns recommended mainstream sources, states that they are preferred rather than exclusive, and warns against low-trust sources

### Requirement: Installation requires explicit user confirmation
The search-guidance flow SHALL require the agent to ask the user which candidate ids to install before the gateway produces installation handoff instructions.

The tool SHALL support confirmation of one or more candidate ids in a single flow.

#### Scenario: Candidate list is ready for user choice
- **WHEN** the gateway has returned a shortlist of candidates and no confirmed ids yet
- **THEN** the response tells the agent to ask the user to confirm one or more candidate ids before proceeding with installation handoff

### Requirement: Confirmed candidates hand off to existing import tools
After the user confirms candidate ids, the search-guidance tool SHALL return install guidance that maps each confirmed candidate to the existing AAI Gateway import capability that should be used next.

The handoff SHALL:
- use `mcp:import` for MCP candidates
- use `skill:import` for skill candidates
- include the source configuration or repository location the agent needs for the follow-up import call

#### Scenario: User confirms multiple candidates
- **WHEN** the agent calls the search-guidance tool with a shortlist and one or more confirmed candidate ids
- **THEN** the gateway returns an installation handoff plan that tells the agent which existing import tool to call for each confirmed candidate

### Requirement: Search guidance includes retrieval fallback advice
If the agent does not already have a web retrieval capability, the search-guidance tool SHALL return fallback instructions that explain how to obtain one before continuing the search workflow.

The fallback guidance SHALL include an importable fetch-style MCP example that can be installed through the existing MCP import flow.

#### Scenario: Agent lacks a retrieval tool
- **WHEN** the agent needs to search remote repositories but has no available web retrieval capability
- **THEN** the gateway returns fallback guidance that includes an example fetch MCP configuration the agent can import through `mcp:import`
