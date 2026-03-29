export const SEARCH_DISCOVER_TOOL_NAME = 'search:discover';

export const searchDiscoverInputSchema: Record<string, unknown> = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

const SEARCH_DISCOVER_GUIDE = `# MCP & Skill Search Guide

Use this guide when you need to find new MCP servers or skills for the user.

## Where to Search

### MCP Sources
- Official MCP Registry: https://github.com/modelcontextprotocol/registry
- Official MCP Servers: https://github.com/modelcontextprotocol/servers
- GitHub search: repositories, README files, release pages, and installation docs

### Skill Sources
- OpenAI Skills: https://github.com/openai/skills
- Anthropic Skills: https://github.com/anthropics/skills
- OpenClaw Skills: https://github.com/openclaw/skills
- GitHub search: repositories and real skill directory paths
- Community skill lists and registries

## What to Collect

### Collect for user-facing comparison
For each candidate, collect:
- Type: MCP or Skill
- Name
- Source
- Trust: official / community / experimental
- Score: use the rating from the source when available, such as GitHub stars or a platform rating; omit it when no rating is available
- What it does: one short plain-language summary

### Collect for installation handoff only
Do not show these details in the main comparison table unless the user asks.

For MCP candidates, also collect:
- Install method:
  - local stdio: command + args
  - remote: transport + url
- Whether headers are required
- Whether env variables are required
- The source page that shows the install configuration

For Skill candidates, also collect:
- Download source URL
- The real skill directory path
- Whether the whole skill directory must be downloaded
- The source page that shows the download path or repository path

## How to Evaluate Candidates

When comparing candidates, consider:
- Relevance to the user's task
- Whether the source is official or community-maintained
- Maintenance quality: recent activity, clear README, usable install docs
- Source-provided popularity or rating signals when available
- Safety and clarity of installation requirements

## How to Present Results to the User

After searching, show the user a short comparison table.

Recommended columns:
- Type
- Name
- Source
- Trust
- Score
- What it does

Keep the table short and readable.
Do not put raw install config, headers, env variables, or download payloads into the main user-facing table.

## User Confirmation

After showing the comparison table:
1. Ask the user which MCP or skill they want to install.
2. Wait for explicit user confirmation.
3. Only then continue with import.

## Import Next Step

After the user confirms a candidate:

- If the user chose an MCP server:
  - Use \`mcp:import\`

- If the user chose a skill:
  - First make sure the whole skill directory is available locally
  - Then use \`skill:import\`

## Important Notes

- \`search:discover\` only provides search guidance.
- You must perform the actual web search yourself.
- You must prepare the comparison table yourself.
- You must ask for user confirmation yourself.
- You must call the appropriate AAI import tool yourself after confirmation.
`;

export function parseSearchDiscoverArguments(args: Record<string, unknown> | undefined): void {
  if (!args || Object.keys(args).length === 0) {
    return;
  }

  throw new Error(`${SEARCH_DISCOVER_TOOL_NAME} does not accept arguments`);
}

export function buildSearchDiscoverResponse(): string {
  return SEARCH_DISCOVER_GUIDE;
}
