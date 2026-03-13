import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialManager } from './manager.js';
import type { SecureStorage } from '../storage/secure-storage/interface.js';
import type {
  AppCredentialDialogResult,
  CredentialDialog,
  CredentialDialogResult,
} from './dialog/interface.js';
import { AaiError } from '../errors/errors.js';
import { getSystemLocale } from '../utils/locale.js';
import type { AaiJson } from '../types/aai-json.js';

describe('CredentialManager', () => {
  let manager: CredentialManager;
  let storageData: Map<string, string>;
  let storage: SecureStorage;
  let dialog: CredentialDialog;

  beforeEach(() => {
    storageData = new Map();
    storage = {
      get: vi.fn(async (key: string) => storageData.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        storageData.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        storageData.delete(key);
      }),
    };

    dialog = {
      show: vi.fn(async () => ({ action: 'cancel' }) as CredentialDialogResult),
      showForAppCredential: vi.fn(
        async () => ({ action: 'cancel' }) as AppCredentialDialogResult
      ),
    };

    manager = new CredentialManager(storage, dialog);
  });

  it('returns auth guidance payload when api key help is requested', async () => {
    const descriptor: AaiJson = {
      schemaVersion: '1.0',
      version: '1.0.0',
      platform: 'web',
      app: {
        id: 'com.notion.api',
        name: { en: 'Notion' },
        defaultLang: 'en',
        description: 'Docs and notes',
      },
      execution: { type: 'http', baseUrl: 'https://api.notion.com/v1' },
      auth: {
        type: 'apiKey',
        apiKey: {
          location: 'header',
          name: 'Authorization',
          prefix: 'Bearer',
          obtainUrl: 'https://www.notion.so/my-integrations',
          instructions: 'Open My Integrations, create a token, then paste it into the gateway.',
        },
      },
      tools: [],
    };

    vi.mocked(dialog.show).mockResolvedValue({ action: 'help' });

    const error = await manager.getCredential(descriptor).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AaiError);
    expect((error as AaiError).code).toBe('AUTH_REQUIRED');
    expect((error as AaiError).data).toEqual({
      app_id: 'com.notion.api',
      app_name: 'Notion',
      auth_type: 'apiKey',
      instructions: 'Open My Integrations, create a token, then paste it into the gateway.',
      preferred_locale: getSystemLocale(),
      obtain_url: 'https://www.notion.so/my-integrations',
    });
  });

  it('returns auth guidance payload when app credential help is requested', async () => {
    const descriptor: AaiJson = {
      schemaVersion: '1.0',
      version: '1.0.0',
      platform: 'web',
      app: {
        id: 'com.feishu.api',
        name: { en: 'Feishu' },
        defaultLang: 'en',
        description: 'Collaboration suite',
      },
      execution: { type: 'http', baseUrl: 'https://open.feishu.cn' },
      auth: {
        type: 'appCredential',
        appCredential: {
          tokenEndpoint: 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
          tokenType: 'tenantAccessToken',
          expiresIn: 7200,
          instructions:
            'Open the Feishu developer console, copy the App ID and App Secret, then paste them into the gateway.',
        },
      },
      tools: [],
    };

    vi.mocked(dialog.showForAppCredential).mockResolvedValue({ action: 'help' });

    const error = await manager.getCredential(descriptor).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AaiError);
    expect((error as AaiError).code).toBe('AUTH_REQUIRED');
    expect((error as AaiError).data).toEqual({
      app_id: 'com.feishu.api',
      app_name: 'Feishu',
      auth_type: 'appCredential',
      instructions:
        'Open the Feishu developer console, copy the App ID and App Secret, then paste them into the gateway.',
      preferred_locale: getSystemLocale(),
      obtain_url: undefined,
    });
  });
});
