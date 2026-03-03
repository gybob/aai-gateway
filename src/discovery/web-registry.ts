import type { AaiJson } from '../types/aai-json.js';
import { yuqueDescriptor } from './descriptors/yuque.js';
import { notionDescriptor } from './descriptors/notion.js';
import { feishuDescriptor } from './descriptors/feishu.js';

/**
 * Built-in web app descriptors
 *
 * These are used when:
 * 1. The web app doesn't have a .well-known/aai.json
 * 2. We want to provide better auth configuration
 * 3. We want to customize the descriptor for better integration
 */
export const WEB_APP_REGISTRY: Map<string, AaiJson> = new Map();

// Register built-in apps

// Yuque (语雀)
WEB_APP_REGISTRY.set('yuque.com', yuqueDescriptor);
WEB_APP_REGISTRY.set('www.yuque.com', yuqueDescriptor);
WEB_APP_REGISTRY.set('api.yuque.com', yuqueDescriptor);
WEB_APP_REGISTRY.set('语雀', yuqueDescriptor);
WEB_APP_REGISTRY.set('yuque', yuqueDescriptor);

// Notion
WEB_APP_REGISTRY.set('notion.com', notionDescriptor);
WEB_APP_REGISTRY.set('www.notion.com', notionDescriptor);
WEB_APP_REGISTRY.set('notion', notionDescriptor);
WEB_APP_REGISTRY.set('诺馨', notionDescriptor);
WEB_APP_REGISTRY.set('笔记', notionDescriptor);

// Feishu (飞书) / Lark
WEB_APP_REGISTRY.set('feishu.cn', feishuDescriptor);
WEB_APP_REGISTRY.set('open.feishu.cn', feishuDescriptor);
WEB_APP_REGISTRY.set('飞书', feishuDescriptor);
WEB_APP_REGISTRY.set('feishu', feishuDescriptor);
WEB_APP_REGISTRY.set('lark.com', feishuDescriptor);
WEB_APP_REGISTRY.set('larksuite.com', feishuDescriptor);
WEB_APP_REGISTRY.set('lark', feishuDescriptor);

/**
 * Look up a web app descriptor by URL or name
 */
export function lookupWebAppRegistry(input: string): AaiJson | null {
  // Try direct lookup
  const direct = WEB_APP_REGISTRY.get(input.toLowerCase());
  if (direct) return direct;

  // Try extracting domain from URL
  try {
    const url = new URL(
      input.startsWith('http://') || input.startsWith('https://') ? input : `https://${input}`
    );
    const domain = url.hostname.toLowerCase();

    // Try exact domain
    const byDomain = WEB_APP_REGISTRY.get(domain);
    if (byDomain) return byDomain;

    // Try without www prefix
    const withoutWww = domain.replace(/^www\./, '');
    const byDomainNoWww = WEB_APP_REGISTRY.get(withoutWww);
    if (byDomainNoWww) return byDomainNoWww;
  } catch {
    // Not a valid URL, ignore
  }

  return null;
}

/**
 * Get all registered web app IDs
 */
export function getRegisteredWebApps(): string[] {
  const seen = new Set<string>();
  for (const descriptor of WEB_APP_REGISTRY.values()) {
    seen.add(descriptor.app.id);
  }
  return Array.from(seen);
}
