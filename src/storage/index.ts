/**
 * Storage Module
 *
 * Provides unified storage interfaces and implementations for managing
 * app descriptors, registries, and caches.
 */

// Core implementations
export { FileRegistry } from './registry.js';
export { SimpleCache } from './cache.js';

// Regsitries
export { McpRegistry, getMcpRegistry } from './mcp-registry.js';
export type { McpRegistryEntry } from './mcp-registry.js';
export { SkillRegistry, getSkillRegistry } from './skill-registry.js';
export type { SkillRegistryEntry } from './skill-registry.js';
export { ManagedRegistry, getManagedRegistry } from './managed-registry.js';
export type { ManagedEntry } from './managed-registry.js';

// Paths
export {
  getManagedAppsRoot,
  getManagedAppDir,
} from './paths.js';

