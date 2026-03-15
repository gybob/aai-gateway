import { AaiError } from '../errors/errors.js';
import { ManagedIntegrationStore } from './managed-store.js';
import type {
  AaiDescriptor,
  ManagedIntegrationRecord,
  PrimitiveSummary,
  Runtime,
  ToolDef,
} from '../aai/types.js';

export class IntegrationRegistry {
  private readonly records = new Map<string, ManagedIntegrationRecord>();

  constructor(private readonly store = new ManagedIntegrationStore()) {}

  async load(): Promise<void> {
    const records = await this.store.list();
    this.records.clear();

    for (const record of records) {
      this.records.set(record.metadata.integrationId, record);
    }
  }

  list(): ManagedIntegrationRecord[] {
    return [...this.records.values()].sort((left, right) =>
      left.metadata.integrationId.localeCompare(right.metadata.integrationId),
    );
  }

  get(integrationId: string): ManagedIntegrationRecord {
    const record = this.records.get(integrationId);
    if (!record) {
      throw new AaiError('NOT_FOUND', `Integration '${integrationId}' not found`);
    }
    return record;
  }

  resolveRuntime(descriptor: AaiDescriptor, runtimeId?: string): Runtime {
    if (runtimeId) {
      const runtime = descriptor.runtimes.find((candidate) => candidate.id === runtimeId);
      if (runtime) {
        return runtime;
      }
    }

    const defaultRuntime = descriptor.runtimes.find((candidate) => candidate.default);
    if (defaultRuntime) {
      return defaultRuntime;
    }

    return descriptor.runtimes[0];
  }

  resolveSummary(integrationId: string, primitiveRef: string): PrimitiveSummary {
    const descriptor = this.get(integrationId).descriptor;
    const summary = [
      ...(descriptor.catalog.tools.summary ?? []),
      ...(descriptor.catalog.prompts?.summary ?? []),
      ...(descriptor.catalog.resources?.summary ?? []),
      ...(descriptor.catalog.resourceTemplates?.summary ?? []),
    ].find((item) => item.ref === primitiveRef);

    if (!summary) {
      throw new AaiError(
        'NOT_FOUND',
        `Primitive '${primitiveRef}' not found in integration '${integrationId}'`,
      );
    }

    return summary;
  }

  resolveTool(integrationId: string, primitiveRef: string): ToolDef {
    const descriptor = this.get(integrationId).descriptor;
    const tool = descriptor.catalog.tools.snapshot?.find((entry) => entry.ref === primitiveRef);
    if (!tool) {
      throw new AaiError(
        'NOT_FOUND',
        `Tool definition '${primitiveRef}' not found in integration '${integrationId}'`,
      );
    }
    return tool;
  }
}
