import type { AaiDescriptor, PrimitiveSummary } from '../aai/types.js';
import { getIdentityText } from '../aai/types.js';
import { listUriTemplateVariables } from '../shared/uri-template.js';

export interface ModelSurfaceTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class DisclosureEngine {
  listVisibleSummaries(descriptor: AaiDescriptor): PrimitiveSummary[] {
    const summaries = [
      ...(descriptor.catalog.tools.summary ?? []),
      ...(descriptor.catalog.prompts?.summary ?? []),
      ...(descriptor.catalog.resources?.summary ?? []),
      ...(descriptor.catalog.resourceTemplates?.summary ?? []),
    ];

    const limit = descriptor.disclosure?.maxVisibleItems;
    if (!limit || limit <= 0) {
      return summaries;
    }

    return summaries.slice(0, limit);
  }

  buildGuide(descriptor: AaiDescriptor): string {
    const summaries = this.listVisibleSummaries(descriptor);
    const hiddenCount = this.countAllSummaries(descriptor) - summaries.length;
    const lines: string[] = [];

    const displayName =
      descriptor.identity.title ??
      getIdentityText(descriptor.identity.name, descriptor.identity.defaultLang);

    lines.push(`# ${displayName} Integration Guide`);
    lines.push('');
    lines.push(`- Integration ID: ${descriptor.identity.id}`);
    lines.push(`- Version: ${descriptor.identity.version}`);
    lines.push(`- Disclosure Mode: ${descriptor.disclosure?.mode ?? 'preferred'}`);
    if (descriptor.identity.description) {
      lines.push(`- Description: ${descriptor.identity.description}`);
    }
    lines.push('');
    lines.push('## Visible Primitive Summaries');
    lines.push('');

    if (summaries.length === 0) {
      lines.push('No primitive summaries are currently visible.');
    } else {
      for (const summary of summaries) {
        lines.push(`- [${summary.kind}] ${summary.name}`);
        lines.push(`  ref: ${summary.ref}`);
        if (summary.description) {
          lines.push(`  ${summary.description}`);
        }
        if (summary.kind === 'resource-template') {
          const template = descriptor.catalog.resourceTemplates?.snapshot?.find((entry) => entry.ref === summary.ref);
          if (template) {
            const variables = listUriTemplateVariables(template.uriTemplate);
            if (variables.length > 0) {
              lines.push(`  uri variables: ${variables.join(', ')}`);
            }
          }
        }
      }
    }

    if (hiddenCount > 0) {
      lines.push('');
      lines.push(`- ${hiddenCount} additional primitives are hidden by disclosure limits.`);
    }

    lines.push('');
    lines.push('## Execution');
    lines.push('');
    lines.push('```json');
    lines.push(
      JSON.stringify(
        {
          integrationId: descriptor.identity.id,
          primitiveRef: summaries[0]?.ref ?? '<primitive-ref>',
          arguments: {},
        },
        null,
        2,
      ),
    );
    lines.push('```');

    return lines.join('\n');
  }

  countAllSummaries(descriptor: AaiDescriptor): number {
    return [
      ...(descriptor.catalog.tools.summary ?? []),
      ...(descriptor.catalog.prompts?.summary ?? []),
      ...(descriptor.catalog.resources?.summary ?? []),
      ...(descriptor.catalog.resourceTemplates?.summary ?? []),
    ].length;
  }
}
