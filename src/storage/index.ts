/**
 * Storage Module
 *
 * Provides unified storage interfaces and implementations for managing
 * app descriptors, registries, and caches.
 */

// Types
export type { RegistryItem, Registry } from '../types/index.js';

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

// Caches
export {
  getDescriptorCache,
  setDescriptorCache,
  getStaleDescriptorCache,
} from './descriptor-cache.js';

// Paths
export {
  getManagedAppsRoot,
  getManagedAppDir,
} from './paths.js';

// Secure Storage
export { createSecureStorage, type SecureStorage } from './secure-storage/index.js';
