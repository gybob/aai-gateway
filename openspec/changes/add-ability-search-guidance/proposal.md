## Why

AAI Gateway already lets agents import MCP servers and skills after the user has identified what to install, but it does not yet help agents discover likely integrations from a user request. That gap forces users or agents to manually know which MCP registries and skill repositories to search before the existing import flows can be used.

## What Changes

- Add a new guidance-first tool, tentatively named `ability_search`, that helps an agent translate a natural-language user request into search keywords and repository-specific search guidance.
- Return a structured candidate list of MCP servers and skills from mainstream sources instead of performing installation directly in the same step.
- Include a user-confirmation step where the agent presents candidates with a temporary selection id, display name, source, and popularity signal such as GitHub stars before asking which items to install.
- Let the tool guide the agent to use existing `mcp:import` and `skill:import` flows after the user confirms one or more candidates.
- Add a curated-source policy that recommends mainstream, high-trust sources first, without making them a hard allowlist.
- Define fallback guidance for agents that do not already have a web retrieval tool by suggesting import of a fetch-style MCP such as `mcp-fetch-server`.
- Clarify naming: keep `ability_search` as the working name for now, but explicitly evaluate whether a more natural English name such as `integration_search` or `capability_search` should become the public tool name.

## Capabilities

### New Capabilities
- `ability-search-guidance`: Defines a search-guidance tool that helps agents discover candidate MCP servers and skills, present ranked options, collect user confirmation, and hand off installation to existing import tools.

### Modified Capabilities
- None.

## Impact

- MCP server tool surface and tool descriptions
- Search-guidance response schema and prompting behavior
- Source selection and safety policy for external discovery
- Import orchestration between search guidance and `mcp:import` / `skill:import`
- README and other documentation for discovery-before-import workflows and optional fetch-tool fallback
- Tests covering candidate formatting, confirmation flow, and install handoff
