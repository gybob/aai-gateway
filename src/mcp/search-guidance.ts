import { buildMcpImportConfig, buildSkillImportSource, validateImportHeaders } from './importer.js';

export const SEARCH_DISCOVER_TOOL_NAME = 'search:discover';

/**
 * MCP/Skills Discovery Search Tool
 * 
 * Agent guidance: ALWAYS call this tool first when searching for MCP servers or skills.
 * This tool provides search strategy guidance and normalizes candidate results.
 */
export const searchDiscoverInputSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    request: {
      type: 'string',
      description:
        'Required. The user request or capability need you want to satisfy. Example: "I need to search GitHub issues and PRs".',
    },
    hasRetrievalTool: {
      type: 'boolean',
      description:
        'Optional. Set to false when you do not have a web retrieval tool. The response will include fetch-tool guidance.',
    },
    evidence: {
      type: 'array',
      description:
        'Optional. Search results from preferred sources. Include name, url, type (mcp/skill), stars, description, and install hints when available.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: ['mcp', 'skill'] },
          source: { type: 'string' },
          url: { type: 'string' },
          description: { type: 'string' },
          stars: { type: 'number' },
          popularity: { type: 'string' },
          install: {
            type: 'object',
            properties: {
              transport: { type: 'string', enum: ['streamable-http', 'sse'] },
              url: { type: 'string' },
              path: { type: 'string' },
              headers: { type: 'object', additionalProperties: { type: 'string' } },
              command: { type: 'string' },
              args: { type: 'array', items: { type: 'string' } },
              env: { type: 'object', additionalProperties: { type: 'string' } },
              cwd: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        required: ['name', 'url'],
        additionalProperties: false,
      },
    },
    confirmedIds: {
      type: 'array',
      description:
        'Optional. User-confirmed candidate names from the shortlist. Resend the same evidence with confirmed names to get install handoff.',
      items: { type: 'string' },
    },
  },
  required: ['request'],
  additionalProperties: false,
  examples: [
    {
      request: 'Need to search GitHub issues and PRs',
      hasRetrievalTool: true,
    },
    {
      request: 'Need a skill for release notes drafting',
      evidence: [
        {
          name: 'Release Notes Writer',
          type: 'skill',
          source: 'GitHub/openai/skills',
          url: 'https://github.com/openai/skills/tree/main/skills/release-notes',
          stars: 1200,
        },
      ],
      confirmedIds: ['Release Notes Writer'],
    },
  ],
};

// ============================================================================
// Template Constants
// ============================================================================

const TEMPLATE_HEADER = `# MCP & Skills Discovery

## When to Use

Call this tool when the user asks you to:
- Find/search/lookup MCP servers
- Find/search/lookup skills
- Discover tools or capabilities
- Install new integrations

## How to Use

1. **First call** - Get search strategy and guidance
2. **Gather evidence** - Search preferred sources
3. **Second call with evidence** - Get normalized candidate shortlist with scores
4. **User confirmation** - Ask which candidates to install
5. **Third call with confirmed names** - Get install handoff`;

const TEMPLATE_PREFERRED_SOURCES = `## Preferred Sources

{{SOURCES}}

> Use preferred sources as starting points. Outside this list, verify maintainer identity, repo activity, README quality, and license visibility.`;

const TEMPLATE_SEARCH_QUERIES = `## Recommended Search Queries

When searching, use these query patterns:
{{QUERIES}}`;

const TEMPLATE_NO_RETRIEVAL = `## ⚠️ No Retrieval Tool Available

You said you have no web retrieval tool. Import a fetch MCP first to search remote sources:

\`\`\`json
{"command": "npx", "args": ["-y", "mcp-fetch-server"]}
\`\`\``;

const TEMPLATE_NEXT_STEPS = `## Next Steps

1. Search preferred sources using the queries above
2. Gather candidates with: name, url, type (mcp/skill), stars, description
3. Call \`search:discover\` again with \`evidence\` array
4. After normalization, ask user to confirm candidates
5. Call \`search:discover\` with \`confirmedIds\` to get install handoff`;

const TEMPLATE_SHORTLIST_HEADER = `## Candidate Shortlist

| Score | Type | Name | Source | Trust | Popularity |
|-------|------|------|--------|-------|------------|`;

const TEMPLATE_SHORTLIST_ROW = `| {{SCORE}} | {{TYPE}} | **{{NAME}}** | {{SOURCE}} | {{TIER}} | {{STARS}} |
|       |     | {{DESC}} | | | |`;

const TEMPLATE_CONFIRMATION = `## User Confirmation Required

Ask the user to confirm which candidates they want to install.
Then call \`search:discover\` again with the same \`evidence\` and \`confirmedIds\` (candidate names).`;

const TEMPLATE_INSTALL_HANDSOFF = `## Installation Handoff

{{CANDIDATES}}

> After inspection, ask user to confirm exposure mode, keywords, and summary before final import.`;

const TEMPLATE_CANDIDATE_INSTALL = `### {{NAME}}
- **Type:** {{TYPE}}
- **Source:** {{URL}}
- **Next step:** {{NEXT_STEP}}

{{PAYLOAD}}`;

// ============================================================================
// Type Definitions
// ============================================================================

interface SearchInstallHintInput {
  transport?: 'streamable-http' | 'sse';
  url?: string;
  path?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

interface SearchEvidenceInput {
  name: string;
  type?: 'mcp' | 'skill';
  source?: string;
  url: string;
  description?: string;
  stars?: number;
  popularity?: string;
  install?: SearchInstallHintInput;
}

export interface SearchDiscoverArguments {
  request: string;
  hasRetrievalTool: boolean;
  evidence: SearchEvidenceInput[];
  confirmedNames: string[];
}

type SourceTier = 'official' | 'community' | 'high-scrutiny' | 'unclassified';

interface NormalizedCandidate {
  name: string;
  type: 'mcp' | 'skill';
  source: string;
  url: string;
  description?: string;
  stars?: number;
  popularity?: string;
  tier: SourceTier;
  relevanceScore: number;
  install?: SearchInstallHintInput;
}

// ============================================================================
// Preferred Sources Data
// ============================================================================

const PREFERRED_SOURCES: Array<{ label: string; url: string; tier: SourceTier; reason: string }> = [
  {
    label: 'Official MCP Registry',
    url: 'https://github.com/modelcontextprotocol/registry',
    tier: 'official',
    reason: 'Primary MCP ecosystem registry under the official MCP GitHub organization.',
  },
  {
    label: 'Official MCP Servers',
    url: 'https://github.com/modelcontextprotocol/servers',
    tier: 'official',
    reason: 'Official MCP server catalog and examples maintained by the MCP organization.',
  },
  {
    label: 'OpenAI Skills Catalog',
    url: 'https://github.com/openai/skills',
    tier: 'official',
    reason: 'Official public skills catalog for Codex-oriented skills.',
  },
  {
    label: 'awesome-mcp-servers',
    url: 'https://github.com/punkpeye/awesome-mcp-servers',
    tier: 'community',
    reason: 'Community-curated MCP discovery list; useful for breadth, but not authoritative.',
  },
  {
    label: 'awesome-claude-skills',
    url: 'https://github.com/ComposioHQ/awesome-claude-skills',
    tier: 'community',
    reason: 'Community-curated skill list; useful for discovery, but not an official catalog.',
  },
];

// ============================================================================
// Argument Parsing
// ============================================================================

export function parseSearchDiscoverArguments(
  args: Record<string, unknown> | undefined
): SearchDiscoverArguments {
  const request = asTrimmedString(args?.request);
  if (!request) {
    throw new Error(`${SEARCH_DISCOVER_TOOL_NAME} requires a non-empty 'request'`);
  }

  const evidence = parseEvidence(args?.evidence);
  const confirmedNames = parseConfirmedNames(args?.confirmedIds);

  return {
    request,
    hasRetrievalTool: args?.hasRetrievalTool !== false,
    evidence,
    confirmedNames,
  };
}

// ============================================================================
// Response Building
// ============================================================================

export function buildSearchDiscoverResponse(args: SearchDiscoverArguments): string {
  const sections: string[] = [];

  // Header
  sections.push(TEMPLATE_HEADER);
  sections.push('');
  sections.push(`**Your request:** ${args.request}`);
  sections.push('');

  // Preferred Sources
  sections.push(
    TEMPLATE_PREFERRED_SOURCES.replace(
      '{{SOURCES}}',
      PREFERRED_SOURCES.map(
        (s) => `- [${s.tier}] **${s.label}**: ${s.url}\n  ${s.reason}`
      ).join('\n')
    )
  );
  sections.push('');

  // Search Queries
  sections.push(
    TEMPLATE_SEARCH_QUERIES.replace(
      '{{QUERIES}}',
      buildQueryPlan(args.request).map((q) => `- \`${q}\``).join('\n')
    )
  );
  sections.push('');

  // No Retrieval Tool Warning
  if (!args.hasRetrievalTool) {
    sections.push(TEMPLATE_NO_RETRIEVAL);
    sections.push('');
  }

  // Evidence processing
  if (args.evidence.length === 0) {
    sections.push(TEMPLATE_NEXT_STEPS);
    return sections.join('\n');
  }

  // Normalize and sort candidates
  const candidates = normalizeCandidates(args.evidence, args.request);

  // Shortlist table
  sections.push(TEMPLATE_SHORTLIST_HEADER);
  for (const c of candidates) {
    const stars = c.stars ? `⭐ ${formatCompactNumber(c.stars)}` : '-';
    const desc = c.description
      ? c.description.slice(0, 80) + (c.description.length > 80 ? '...' : '')
      : '';
    sections.push(
      TEMPLATE_SHORTLIST_ROW
        .replace('{{SCORE}}', c.relevanceScore.toFixed(1))
        .replace('{{TYPE}}', c.type)
        .replace('{{NAME}}', c.name)
        .replace('{{SOURCE}}', c.source)
        .replace('{{TIER}}', c.tier)
        .replace('{{STARS}}', stars)
        .replace('{{DESC}}', desc)
    );
  }
  sections.push('');

  // Confirmation required
  if (args.confirmedNames.length === 0) {
    sections.push(TEMPLATE_CONFIRMATION);
    return sections.join('\n');
  }

  // Install handoff
  const confirmed = resolveConfirmedCandidates(candidates, args.confirmedNames);
  const candidateBlocks = confirmed.map((c) => {
    const nextStep = c.type === 'mcp' 
      ? 'Call `mcp:import` with the install payload' 
      : 'Download and extract to a local directory, then call `skill:import` with the path';
    const payload = c.type === 'mcp'
      ? buildMcpImportPayload(c.install)
      : buildSkillImportPayload(c.install);
    const payloadBlock = payload
      ? `\n**Import payload:**\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``
      : '';

    return TEMPLATE_CANDIDATE_INSTALL
      .replace('{{NAME}}', c.name)
      .replace('{{TYPE}}', c.type)
      .replace('{{URL}}', c.url)
      .replace('{{NEXT_STEP}}', nextStep)
      .replace('{{PAYLOAD}}', payloadBlock);
  });

  sections.push(
    TEMPLATE_INSTALL_HANDSOFF.replace('{{CANDIDATES}}', candidateBlocks.join('\n'))
  );

  return sections.join('\n');
}

// ============================================================================
// Candidate Processing
// ============================================================================

function normalizeCandidates(evidence: SearchEvidenceInput[], request: string): NormalizedCandidate[] {
  const normalized = evidence.map((item) => ({
    name: item.name.trim(),
    type: inferCandidateType(item),
    source: item.source?.trim() || inferSourceLabel(item.url),
    url: item.url.trim(),
    description: asOptionalTrimmedString(item.description),
    stars: typeof item.stars === 'number' && Number.isFinite(item.stars) ? item.stars : undefined,
    popularity: normalizePopularity(item.stars, item.popularity),
    tier: inferSourceTier(item.url, item.source ?? ''),
    relevanceScore: calculateRelevanceScore(item, request),
    install: normalizeInstallHint(item.install),
  }));

  // Sort by relevance score, then by stars
  return normalized.sort((a, b) => {
    const scoreDelta = b.relevanceScore - a.relevanceScore;
    if (Math.abs(scoreDelta) > 0.5) return scoreDelta;
    return (b.stars ?? -1) - (a.stars ?? -1);
  });
}

function calculateRelevanceScore(item: SearchEvidenceInput, request: string): number {
  let score = 50;

  // Official sources get bonus
  const tier = inferSourceTier(item.url, item.source ?? '');
  if (tier === 'official') score += 20;
  else if (tier === 'community') score += 10;

  // Stars bonus (capped at 15 points)
  if (item.stars) {
    score += Math.min(15, Math.log10(Math.max(1, item.stars)) * 3);
  }

  // Keyword matching
  const combined = `${item.name} ${item.description ?? ''} ${item.source ?? ''} ${item.url}`.toLowerCase();
  const keywords = request.toLowerCase().split(/\s+/);
  for (const kw of keywords) {
    if (kw.length > 2 && combined.includes(kw)) {
      score += 3;
    }
  }

  return Math.min(100, Math.max(0, score));
}

function resolveConfirmedCandidates(
  candidates: NormalizedCandidate[],
  confirmedNames: string[]
): NormalizedCandidate[] {
  const uniqueNames = Array.from(new Set(confirmedNames.map((n) => n.trim().toLowerCase())));
  const matched = uniqueNames.map((name) =>
    candidates.find((c) => c.name.toLowerCase() === name)
  );

  const missing = uniqueNames.filter((_, i) => !matched[i]);
  if (missing.length > 0) {
    throw new Error(
      `Unknown candidates: ${missing.join(', ')}. Available: ${candidates.map((c) => c.name).join(', ')}`
    );
  }

  return matched.filter((c): c is NormalizedCandidate => c !== undefined);
}

function buildMcpImportPayload(
  install: SearchInstallHintInput | undefined
): Record<string, unknown> | null {
  if (!install) return null;

  try {
    const config = buildMcpImportConfig({
      transport: install.transport,
      url: asOptionalTrimmedString(install.url),
      command: asOptionalTrimmedString(install.command),
      args: asStringArray(install.args),
      env: isStringRecord(install.env) ? install.env : undefined,
      cwd: asOptionalTrimmedString(install.cwd),
    });

    const payload: Record<string, unknown> = { ...config };
    if (isStringRecord(install.headers)) {
      validateImportHeaders(install.headers);
      payload.headers = install.headers;
    }
    return payload;
  } catch {
    return null;
  }
}

function buildSkillImportPayload(
  install: SearchInstallHintInput | undefined
): Record<string, unknown> | null {
  if (!install) return null;

  try {
    return buildSkillImportSource({
      path: asOptionalTrimmedString(install.path),
      url: asOptionalTrimmedString(install.url),
    }) as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function buildQueryPlan(request: string): string[] {
  const q = request.trim();
  return [
    q,
    `mcp ${q}`,
    `model context protocol ${q}`,
    `skill ${q}`,
    `site:github.com ${q}`,
  ];
}

function inferCandidateType(item: SearchEvidenceInput): 'mcp' | 'skill' {
  if (item.type) return item.type;
  if (item.install?.path) return 'skill';
  if (item.install?.command || item.install?.transport) return 'mcp';

  const combined = `${item.name} ${item.source ?? ''} ${item.url} ${item.description ?? ''}`.toLowerCase();
  if (combined.includes('skill') || item.url.toLowerCase().includes('/skills/')) return 'skill';
  if (combined.includes('mcp')) return 'mcp';
  return 'mcp';
}

function inferSourceLabel(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'github.com') {
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length >= 2) {
        return `GitHub/${segments[0]}/${segments[1]}`;
      }
    }
    return parsed.hostname;
  } catch {
    return 'unknown';
  }
}

function inferSourceTier(url: string, source: string): SourceTier {
  const value = `${url} ${source}`.toLowerCase();

  if (
    value.includes('github.com/modelcontextprotocol/') ||
    value.includes('github.com/openai/skills')
  ) {
    return 'official';
  }
  if (value.includes('github.com/punkpeye/') || value.includes('github.com/composiohq/')) {
    return 'community';
  }
  if (value.includes('clawhub')) {
    return 'high-scrutiny';
  }
  return 'unclassified';
}

function normalizePopularity(stars?: number, popularity?: string): string | undefined {
  if (typeof stars === 'number') {
    return `${formatCompactNumber(stars)} stars`;
  }
  return asOptionalTrimmedString(popularity);
}

function formatCompactNumber(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return String(value);
}

function normalizeInstallHint(
  install: SearchInstallHintInput | undefined
): SearchInstallHintInput | undefined {
  if (!install) return undefined;

  const next: SearchInstallHintInput = {
    transport: install.transport,
    url: asOptionalTrimmedString(install.url),
    path: asOptionalTrimmedString(install.path),
    headers: isStringRecord(install.headers) ? install.headers : undefined,
    command: asOptionalTrimmedString(install.command),
    args: asStringArray(install.args),
    env: isStringRecord(install.env) ? install.env : undefined,
    cwd: asOptionalTrimmedString(install.cwd),
  };

  if (Object.values(next).every((v) => v === undefined || (Array.isArray(v) && v.length === 0))) {
    return undefined;
  }
  return next;
}

// ============================================================================
// Argument Parsing Helpers
// ============================================================================

function parseEvidence(value: unknown): SearchEvidenceInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${SEARCH_DISCOVER_TOOL_NAME} expected 'evidence' to be an array`);
  }
  return value.map((item, index) => parseEvidenceItem(item, index));
}

function parseEvidenceItem(value: unknown, index: number): SearchEvidenceInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${SEARCH_DISCOVER_TOOL_NAME} evidence[${index}] must be an object`);
  }

  const item = value as Record<string, unknown>;
  const name = asTrimmedString(item.name);
  const url = asTrimmedString(item.url);
  if (!name || !url) {
    throw new Error(`${SEARCH_DISCOVER_TOOL_NAME} evidence[${index}] requires non-empty 'name' and 'url'`);
  }

  return {
    name,
    type: item.type === 'mcp' || item.type === 'skill' ? item.type : undefined,
    source: asOptionalTrimmedString(item.source),
    url,
    description: asOptionalTrimmedString(item.description),
    stars: asOptionalNumber(item.stars),
    popularity: asOptionalTrimmedString(item.popularity),
    install: parseInstallHint(item.install, index),
  };
}

function parseInstallHint(value: unknown, index: number): SearchInstallHintInput | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${SEARCH_DISCOVER_TOOL_NAME} evidence[${index}].install must be an object`);
  }

  const install = value as Record<string, unknown>;
  return normalizeInstallHint({
    transport:
      install.transport === 'streamable-http' || install.transport === 'sse'
        ? install.transport
        : undefined,
    url: asOptionalTrimmedString(install.url),
    path: asOptionalTrimmedString(install.path),
    headers: isStringRecord(install.headers) ? install.headers : undefined,
    command: asOptionalTrimmedString(install.command),
    args: asStringArray(install.args),
    env: isStringRecord(install.env) ? install.env : undefined,
    cwd: asOptionalTrimmedString(install.cwd),
  });
}

function parseConfirmedNames(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${SEARCH_DISCOVER_TOOL_NAME} expected 'confirmedIds' to be an array`);
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asOptionalTrimmedString(value: unknown): string | undefined {
  return asTrimmedString(value);
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : [];
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([k, v]) => typeof k === 'string' && typeof v === 'string');
}
