import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { AaiError } from '../errors/errors.js';
import { parseAaiDescriptor } from '../aai/parser.js';
import type {
  AaiDescriptor,
  ManagedIntegrationMetadata,
  ManagedIntegrationRecord,
} from '../aai/types.js';

const DEFAULT_ROOT = join(homedir(), '.aai-gateway');
const INTEGRATIONS_DIR = 'integrations';
const DESCRIPTOR_FILE = 'aai.json';
const METADATA_FILE = 'metadata.json';

export class ManagedIntegrationStore {
  constructor(private readonly rootDir = DEFAULT_ROOT) {}

  get integrationsDir(): string {
    return join(this.rootDir, INTEGRATIONS_DIR);
  }

  async ensure(): Promise<void> {
    await mkdir(this.integrationsDir, { recursive: true });
  }

  async list(): Promise<ManagedIntegrationRecord[]> {
    await this.ensure();
    const ids = await readdir(this.integrationsDir, { withFileTypes: true });
    const records: ManagedIntegrationRecord[] = [];

    for (const entry of ids) {
      if (!entry.isDirectory()) {
        continue;
      }

      const record = await this.get(entry.name);
      if (record) {
        records.push(record);
      }
    }

    records.sort((left, right) => left.metadata.integrationId.localeCompare(right.metadata.integrationId));
    return records;
  }

  async get(integrationId: string): Promise<ManagedIntegrationRecord | null> {
    await this.ensure();
    const integrationDir = this.getIntegrationDir(integrationId);

    try {
      const [descriptorRaw, metadataRaw] = await Promise.all([
        readFile(join(integrationDir, DESCRIPTOR_FILE), 'utf-8'),
        readFile(join(integrationDir, METADATA_FILE), 'utf-8'),
      ]);

      const descriptor = parseAaiDescriptor(JSON.parse(descriptorRaw));
      const metadata = JSON.parse(metadataRaw) as ManagedIntegrationMetadata;
      return { descriptor, metadata };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async put(
    descriptor: AaiDescriptor,
    metadata: Omit<ManagedIntegrationMetadata, 'integrationId' | 'importedAt' | 'updatedAt' | 'sourceHash'> & {
      integrationId?: string;
      importedAt?: string;
      sourceHash?: string;
    },
  ): Promise<ManagedIntegrationRecord> {
    await this.ensure();

    const integrationId = metadata.integrationId ?? descriptor.identity.id;
    if (!integrationId) {
      throw new AaiError('INVALID_REQUEST', 'Managed integrations require a stable integration ID');
    }

    const now = new Date().toISOString();
    const normalizedDescriptor: AaiDescriptor = {
      ...descriptor,
      identity: {
        ...descriptor.identity,
        id: integrationId,
      },
    };

    const sourceHash = metadata.sourceHash ?? createContentHash(normalizedDescriptor);
    const record: ManagedIntegrationRecord = {
      descriptor: normalizedDescriptor,
      metadata: {
        integrationId,
        importedAt: metadata.importedAt ?? now,
        updatedAt: now,
        sourceType: metadata.sourceType,
        sourceHash,
        converterVersion: metadata.converterVersion,
        notes: metadata.notes,
      },
    };

    const integrationDir = this.getIntegrationDir(integrationId);
    await mkdir(integrationDir, { recursive: true });
    await Promise.all([
      writeFile(join(integrationDir, DESCRIPTOR_FILE), JSON.stringify(record.descriptor, null, 2), 'utf-8'),
      writeFile(join(integrationDir, METADATA_FILE), JSON.stringify(record.metadata, null, 2), 'utf-8'),
    ]);

    return record;
  }

  async remove(integrationId: string): Promise<void> {
    await rm(this.getIntegrationDir(integrationId), { recursive: true, force: true });
  }

  getIntegrationDir(integrationId: string): string {
    return join(this.integrationsDir, integrationId);
  }
}

export function slugifyIntegrationId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function createContentHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
