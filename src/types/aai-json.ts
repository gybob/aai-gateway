// ========== Auth Instructions ==========

export interface AuthInstructions {
  short: string;
  detailed?: string;
  helpUrl?: string;
  screenshotUrl?: string;
}

// ========== Auth Types ==========

export interface OAuth2Auth {
  type: 'oauth2';
  oauth2: {
    authorizationEndpoint: string;
    tokenEndpoint: string;
    scopes: string[];
    pkce: { method: 'S256' };
    refreshEndpoint?: string;
    extraParams?: Record<string, string>;
  };
}

export interface ApiKeyAuth {
  type: 'apiKey';
  apiKey: {
    location: 'header' | 'query';
    name: string;
    prefix?: string;
    obtainUrl: string;
    instructions?: AuthInstructions;
  };
}

export interface AppCredentialAuth {
  type: 'appCredential';
  appCredential: {
    tokenEndpoint: string;
    tokenType: 'tenantAccessToken' | 'appAccessToken' | 'userAccessToken';
    expiresIn: number;
    instructions?: AuthInstructions;
  };
}

export interface CookieAuth {
  type: 'cookie';
  cookie: {
    loginUrl: string;
    requiredCookies: string[];
    domain: string;
    instructions?: string;
  };
}

export type AaiAuth = OAuth2Auth | ApiKeyAuth | AppCredentialAuth | CookieAuth;
// ========== Execution Types ==========

export interface IpcExecution {
  type: 'ipc';
}

export interface WebExecution {
  type: 'http';
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
}

export interface AcpStart {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AcpExecution {
  type: 'acp';
  start: AcpStart;
}

export interface CliExecution {
  type: 'cli';
  command: string;
  jsonFlag?: string;
  timeout?: number;
}

export type Execution = IpcExecution | WebExecution | AcpExecution | CliExecution;

// ========== Internationalization ==========

/** BCP 47 language tag */
export type LanguageTag = string;

/** Internationalized name object. Maps language tags to localized names. */
export type InternationalizedName = Record<LanguageTag, string>;

// ========== AaiJson Descriptor ==========

export interface AaiJson {
  schemaVersion: '1.0';
  version: string;
  platform: 'macos' | 'linux' | 'windows' | 'web';
  app: {
    id: string;
    /** Internationalized name object. e.g., { "en": "Reminders", "zh-CN": "提醒事项" } */
    name: InternationalizedName;
    /** Default language tag for fallback. Must exist in name object. */
    defaultLang: LanguageTag;
    /** Brief description in English (for agent consumption) */
    description: string;
    aliases?: string[];
  };
  execution: Execution;
  auth?: AaiAuth;
  tools: Array<{
    name: string;
    description: string;
    parameters: object;
    returns?: object;
    execution?: {
      path: string;
      method: string;
      headers?: Record<string, string>;
    };
  }>;
}

// ========== Desktop App Discovery ==========

export interface DiscoveredDesktopApp {
  bundlePath: string;
  appId: string;
  name: string;
  description: string;
  descriptor: AaiJson;
}

// ========== Helper Functions ==========

/**
 * Get localized name from internationalized name object
 * Fallback logic:
 * 1. Exact match: name[locale]
 * 2. Language family fallback: zh-TW -> zh-CN
 * 3. Default: name[defaultLang]
 */
export function getLocalizedName(
  name: InternationalizedName,
  locale: LanguageTag,
  defaultLang: LanguageTag
): string {
  // 1. Exact match
  if (name[locale]) {
    return name[locale];
  }

  // 2. Language family fallback
  const lang = locale.split('-')[0];
  const fallback = Object.keys(name).find((k) => k.startsWith(lang));
  if (fallback && name[fallback]) {
    return name[fallback];
  }

  // 3. Default
  return name[defaultLang] ?? Object.values(name)[0] ?? '';
}

export function isCliExecution(execution: Execution): execution is CliExecution {
  return execution.type === 'cli';
}

export function isAcpExecution(execution: Execution): execution is AcpExecution {
  return execution.type === 'acp';
}

export function isWebExecution(execution: Execution): execution is WebExecution {
  return execution.type === 'http';
}

export function isIpcExecution(execution: Execution): execution is IpcExecution {
  return execution.type === 'ipc';
}
