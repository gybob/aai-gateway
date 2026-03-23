import { buildMcpImportConfig, buildSkillImportSource, validateImportHeaders } from './importer.js';

export const IMPORT_SEARCH_TOOL_NAME = 'import:search';
export const IMPORT_SEARCH_TOOL_ALIASES = ['ability_search'] as const;

type SourceTier = 'official' | 'community' | 'high-scrutiny' | 'unclassified';
type CandidateType = 'mcp' | 'skill';

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
  type?: CandidateType;
  source?: string;
  url: string;
  description?: string;
  stars?: number;
  popularity?: string;
  install?: SearchInstallHintInput;
}

export interface ImportSearchArguments {
  request: string;
  hasRetrievalTool: boolean;
  evidence: SearchEvidenceInput[];
  confirmedIds: string[];
}

interface PreferredSource {
  label: string;
  url: string;
  tier: SourceTier;
  reason: string;
}

interface NormalizedCandidate {
  id: string;
  type: CandidateType;
  name: string;
  source: string;
  url: string;
  description?: string;
  stars?: number;
  popularity?: string;
  tier: SourceTier;
  install?: SearchInstallHintInput;
}

const PREFERRED_SOURCES: PreferredSource[] = [
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
  {
    label: 'Open marketplaces such as ClawHub',
    url: 'https://clawhub.dev',
    tier: 'high-scrutiny',
    reason:
      'Open publishing marketplaces can contain malicious or weakly reviewed skills and are not default-trust sources.',
  },
];

export const importSearchInputSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    request: {
      type: 'string',
      description:
        'Required. The user request or installation intent you want to satisfy, for example "I need an MCP that can search GitHub issues".',
    },
    hasRetrievalTool: {
      type: 'boolean',
      description:
        'Optional. Set to false when the agent does not currently have a web retrieval tool. The response will include fetch-tool fallback guidance.',
    },
    evidence: {
      type: 'array',
      description:
        'Optional. Search results gathered by the agent from preferred sources. Provide this to normalize candidates and generate user-facing selection ids.',
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
        'Optional. Candidate ids confirmed by the user. Resend the same evidence array together with these ids to generate an install handoff plan.',
      items: { type: 'string' },
    },
  },
  required: ['request'],
  additionalProperties: false,
  examples: [
    {
      request: 'Need an MCP or skill that can search GitHub issues and PRs',
      hasRetrievalTool: true,
    },
    {
      request: 'Need a skill for release notes and changelog drafting',
      evidence: [
        {
          name: 'Release Notes Writer',
          type: 'skill',
          source: 'GitHub/openai/skills',
          url: 'https://github.com/openai/skills/tree/main/skills/release-notes',
          stars: 1200,
          install: {
            url: 'https://raw.githubusercontent.com/openai/skills/main/skills/release-notes',
          },
        },
      ],
      confirmedIds: ['skill-abc123'],
    },
  ],
};

export function parseImportSearchArguments(
  args: Record<string, unknown> | undefined
): ImportSearchArguments {
  const request = asTrimmedString(args?.request);
  if (!request) {
    throw new Error(`${IMPORT_SEARCH_TOOL_NAME} requires a non-empty 'request'`);
  }

  const evidence = parseEvidence(args?.evidence);
  const confirmedIds = parseConfirmedIds(args?.confirmedIds);

  return {
    request,
    hasRetrievalTool: args?.hasRetrievalTool === false ? false : true,
    evidence,
    confirmedIds,
  };
}

export function buildImportSearchResponse(args: ImportSearchArguments): string {
  const lines: string[] = [];
  lines.push(`Search intent: ${args.request}`);
  lines.push('');
  lines.push('Preferred source policy:');
  lines.push(...formatSourcePolicy());
  lines.push('');
  lines.push('Suggested queries:');
  lines.push(...buildQueryPlan(args.request).map((query) => `- ${query}`));

  if (!args.hasRetrievalTool) {
    lines.push('');
    lines.push('Retrieval fallback:');
    lines.push(...formatFetchFallback());
  }

  if (args.evidence.length === 0) {
    lines.push('');
    lines.push('Next step:');
    lines.push(
      '- Search the preferred sources above with your own retrieval tool. If you do not have one, import a fetch MCP first.'
    );
    lines.push(
      '- Gather candidate evidence with at least `name` and `url`. Include `type`, `source`, `stars`, `description`, and `install` hints when available.'
    );
    lines.push(
      `- Call \`${IMPORT_SEARCH_TOOL_NAME}\` again with the same \`request\` plus an \`evidence\` array so the gateway can normalize a shortlist.`
    );
    return lines.join('\n');
  }

  const candidates = normalizeCandidates(args.evidence);
  lines.push('');
  lines.push('Candidate shortlist:');
  lines.push(...formatCandidates(candidates));

  if (args.confirmedIds.length === 0) {
    lines.push('');
    lines.push('User confirmation required:');
    lines.push('- Ask the user to confirm one or more candidate ids from the shortlist above.');
    lines.push(
      `- Then call \`${IMPORT_SEARCH_TOOL_NAME}\` again with the same \`request\`, the same \`evidence\`, and \`confirmedIds\`.`
    );
    return lines.join('\n');
  }

  const confirmed = resolveConfirmedCandidates(candidates, args.confirmedIds);
  lines.push('');
  lines.push('Installation handoff:');
  lines.push(...formatInstallHandoff(confirmed));
  lines.push('');
  lines.push('Import reminder:');
  lines.push(
    '- After the first `mcp:import` or `skill:import` inspection call, ask the user to confirm exposure mode, keywords, and summary before completing the final import.'
  );

  return lines.join('\n');
}

export function normalizeCandidates(evidence: SearchEvidenceInput[]): NormalizedCandidate[] {
  const seenIds = new Map<string, number>();
  const normalized = evidence.map((item) => {
    const type = inferCandidateType(item);
    const source = item.source?.trim() || inferSourceLabel(item.url);
    const tier = inferSourceTier(item.url, source);
    const install = normalizeInstallHint(item.install);
    const popularity = normalizePopularity(item.stars, item.popularity);
    const baseId = `${type}-${stableHash([type, item.name, item.url, source].join('|'))}`;
    const nextCount = (seenIds.get(baseId) ?? 0) + 1;
    seenIds.set(baseId, nextCount);

    return {
      id: nextCount === 1 ? baseId : `${baseId}-${nextCount}`,
      type,
      name: item.name.trim(),
      source,
      url: item.url.trim(),
      description: asOptionalTrimmedString(item.description),
      stars: typeof item.stars === 'number' && Number.isFinite(item.stars) ? item.stars : undefined,
      popularity,
      tier,
      install,
    } satisfies NormalizedCandidate;
  });

  return normalized.sort((a, b) => {
    const starDelta = (b.stars ?? -1) - (a.stars ?? -1);
    if (starDelta !== 0) {
      return starDelta;
    }

    return a.name.localeCompare(b.name);
  });
}

function resolveConfirmedCandidates(
  candidates: NormalizedCandidate[],
  confirmedIds: string[]
): NormalizedCandidate[] {
  const uniqueIds = Array.from(new Set(confirmedIds.map((item) => item.trim()).filter(Boolean)));
  const matched = uniqueIds.map((id) => candidates.find((candidate) => candidate.id === id));
  const missing = uniqueIds.filter((_id, index) => !matched[index]);

  if (missing.length > 0) {
    throw new Error(
      `${IMPORT_SEARCH_TOOL_NAME} received unknown confirmedIds: ${missing.join(', ')}`
    );
  }

  return matched.filter((candidate): candidate is NormalizedCandidate => Boolean(candidate));
}

function formatInstallHandoff(candidates: NormalizedCandidate[]): string[] {
  const lines: string[] = [];

  for (const candidate of candidates) {
    lines.push(
      `- [${candidate.id}] ${candidate.name} | ${candidate.type} | next step: ${candidate.type === 'mcp' ? '`mcp:import`' : '`skill:import`'}`
    );
    lines.push(`  Source: ${candidate.url}`);

    if (candidate.type === 'mcp') {
      const payload = buildMcpImportPayload(candidate.install);
      if (payload) {
        lines.push('  First import call payload:');
        lines.push(indentBlock(jsonBlock(payload)));
      } else {
        lines.push(
          '  Import status: inspect the repository docs first and extract a supported MCP config snippet before calling `mcp:import`.'
        );
      }
    } else {
      const payload = buildSkillImportPayload(candidate.install);
      if (payload) {
        lines.push('  First import call payload:');
        lines.push(indentBlock(jsonBlock(payload)));
      } else {
        lines.push(
          '  Import status: inspect the skill docs first and find a skill root `url` or local `path` before calling `skill:import`.'
        );
      }
    }
  }

  return lines;
}

function buildMcpImportPayload(
  install: SearchInstallHintInput | undefined
): Record<string, unknown> | null {
  if (!install) {
    return null;
  }

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
  if (!install) {
    return null;
  }

  try {
    const source = buildSkillImportSource({
      path: asOptionalTrimmedString(install.path),
      url: asOptionalTrimmedString(install.url),
    });

    return { ...source };
  } catch {
    return null;
  }
}

function formatCandidates(candidates: NormalizedCandidate[]): string[] {
  return candidates.map((candidate) => {
    const popularity = candidate.popularity ? ` | popularity: ${candidate.popularity}` : '';
    const description = candidate.description ? ` | ${candidate.description}` : '';
    return `- [${candidate.id}] ${candidate.name} | ${candidate.type} | ${candidate.source} | trust: ${candidate.tier}${popularity} | ${candidate.url}${description}`;
  });
}

function buildQueryPlan(request: string): string[] {
  const normalized = request.trim();
  return [
    normalized,
    `mcp ${normalized}`,
    `model context protocol ${normalized}`,
    `skill ${normalized}`,
    `SKILL.md ${normalized}`,
    `site:github.com ${normalized}`,
  ];
}

function formatSourcePolicy(): string[] {
  return PREFERRED_SOURCES.map(
    (source) => `- [${source.tier}] ${source.label}: ${source.url} — ${source.reason}`
  ).concat([
    '- Use the list above as a preferred starting point, not a hard allowlist.',
    '- Avoid arbitrary low-trust or low-signal websites when suggesting installable tools.',
    '- Outside the preferred list, verify maintainer identity, repository activity, README quality, license visibility, and whether the source exposes a real import path or config.',
  ]);
}

function formatFetchFallback(): string[] {
  return [
    '- You said no retrieval tool is available. Import a fetch MCP before searching remote sources if needed.',
    '- Recommended first import call:',
    indentBlock(
      jsonBlock({
        command: 'npx',
        args: ['-y', 'mcp-fetch-server'],
      })
    ),
    '- Optional MCP config details for the underlying server:',
    indentBlock(
      jsonBlock({
        type: 'local',
        command: ['npx', '-y', 'mcp-fetch-server'],
        enabled: true,
        timeout: 50000,
        environment: {
          DEFAULT_LIMIT: '50000',
        },
      })
    ),
  ];
}

function parseEvidence(value: unknown): SearchEvidenceInput[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${IMPORT_SEARCH_TOOL_NAME} expected 'evidence' to be an array`);
  }

  return value.map((item, index) => parseEvidenceItem(item, index));
}

function parseEvidenceItem(value: unknown, index: number): SearchEvidenceInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${IMPORT_SEARCH_TOOL_NAME} evidence[${index}] must be an object`);
  }

  const item = value as Record<string, unknown>;
  const name = asTrimmedString(item.name);
  const url = asTrimmedString(item.url);
  if (!name || !url) {
    throw new Error(
      `${IMPORT_SEARCH_TOOL_NAME} evidence[${index}] requires non-empty 'name' and 'url'`
    );
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
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${IMPORT_SEARCH_TOOL_NAME} evidence[${index}].install must be an object`);
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

function parseConfirmedIds(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${IMPORT_SEARCH_TOOL_NAME} expected 'confirmedIds' to be an array`);
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function inferCandidateType(item: SearchEvidenceInput): CandidateType {
  if (item.type) {
    return item.type;
  }

  if (item.install?.path) {
    return 'skill';
  }

  if (item.install?.command || item.install?.transport || item.install?.headers) {
    return 'mcp';
  }

  const combined =
    `${item.name} ${item.source ?? ''} ${item.url} ${item.description ?? ''}`.toLowerCase();
  if (combined.includes('skill')) {
    return 'skill';
  }

  if (combined.includes('mcp')) {
    return 'mcp';
  }

  if (item.url.toLowerCase().includes('/skills/')) {
    return 'skill';
  }

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
    return 'unclassified';
  }
}

function inferSourceTier(url: string, source: string): SourceTier {
  const value = `${url} ${source}`.toLowerCase();

  if (
    value.includes('github.com/modelcontextprotocol/registry') ||
    value.includes('github.com/modelcontextprotocol/servers') ||
    value.includes('github.com/openai/skills')
  ) {
    return 'official';
  }

  if (
    value.includes('github.com/punkpeye/awesome-mcp-servers') ||
    value.includes('github.com/composiohq/awesome-claude-skills')
  ) {
    return 'community';
  }

  if (value.includes('clawhub')) {
    return 'high-scrutiny';
  }

  return 'unclassified';
}

function normalizePopularity(stars?: number, popularity?: string): string | undefined {
  if (typeof stars === 'number' && Number.isFinite(stars)) {
    return `${formatCompactNumber(stars)} GitHub stars`;
  }

  const normalized = asOptionalTrimmedString(popularity);
  return normalized;
}

function formatCompactNumber(value: number): string {
  if (value >= 1000) {
    const compact = Math.round((value / 1000) * 10) / 10;
    return `${compact}k`;
  }

  return String(value);
}

function normalizeInstallHint(
  install: SearchInstallHintInput | undefined
): SearchInstallHintInput | undefined {
  if (!install) {
    return undefined;
  }

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

  if (
    Object.values(next).every(
      (value) => value === undefined || (Array.isArray(value) && value.length === 0)
    )
  ) {
    return undefined;
  }

  return next;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36).slice(0, 6);
}

function jsonBlock(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function indentBlock(value: string): string {
  return value
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
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
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.entries(value).every(
    ([key, item]) => typeof key === 'string' && typeof item === 'string'
  );
}
