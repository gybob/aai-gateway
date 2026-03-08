import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConsentManager } from './manager.js';
import type { SecureStorage } from '../storage/secure-storage/interface.js';
import type { ConsentDialog, ConsentDialogResult } from './dialog/interface.js';
import type { CallerIdentity } from '../types/consent.js';

describe('ConsentManager - Caller-Scoped Consent Storage', () => {
  let manager: ConsentManager;
  let mockStorage: SecureStorage;
  let mockDialog: ConsentDialog;
  let storageData: Map<string, string>;

  beforeEach(() => {
    storageData = new Map();

    mockStorage = {
      get: vi.fn(async (key: string) => storageData.get(key)),
      set: vi.fn(async (key: string, value: string) => {
        storageData.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        storageData.delete(key);
      }),
    };

    mockDialog = {
      show: vi.fn(),
    };

    manager = new ConsentManager(mockStorage, mockDialog);
  });

  describe('accountKey generation', () => {
    it('should generate caller-scoped storage key', async () => {
      const appId = 'com.example.mail';
      const callerName = 'Claude Desktop';

      // Grant consent for Claude Desktop
      mockDialog.show = vi.fn(
        async () =>
          ({
            decision: 'tool',
            remember: true,
          }) as ConsentDialogResult
      );

      await manager.checkAndPrompt(
        appId,
        'Example Mail',
        { name: 'sendEmail', description: 'Send email', parameters: {} },
        { name: callerName, version: '1.0.0' }
      );

      // Verify: Storage key should include caller name
      const expectedKey = `consent-${callerName}-${appId}`;
      expect(mockStorage.set).toHaveBeenCalledWith(expectedKey, expect.any(String));
    });

    it('should use different keys for different callers', async () => {
      const appId = 'com.example.mail';
      const toolInfo = { name: 'sendEmail', description: 'Send email', parameters: {} };

      // Grant consent for Claude Desktop
      mockDialog.show = vi.fn(
        async () =>
          ({
            decision: 'tool',
            remember: true,
          }) as ConsentDialogResult
      );

      await manager.checkAndPrompt(appId, 'Example Mail', toolInfo, {
        name: 'Claude Desktop',
        version: '1.0.0',
      });

      // Verify: Claude Desktop's consent is stored
      const claudeKey = 'consent-Claude Desktop-com.example.mail';
      expect(storageData.has(claudeKey)).toBe(true);

      // Clear mock for next call
      vi.clearAllMocks();

      // Grant consent for Cursor
      mockDialog.show = vi.fn(
        async () =>
          ({
            decision: 'tool',
            remember: true,
          }) as ConsentDialogResult
      );

      await manager.checkAndPrompt(appId, 'Example Mail', toolInfo, {
        name: 'Cursor',
        version: '2.0.0',
      });

      // Verify: Cursor's consent is stored separately
      const cursorKey = 'consent-Cursor-com.example.mail';
      expect(storageData.has(cursorKey)).toBe(true);

      // Verify: Both keys exist (isolated storage)
      expect(storageData.has(claudeKey)).toBe(true);
      expect(storageData.has(cursorKey)).toBe(true);
    });
  });

  describe('isGranted with caller scope', () => {
    it('should return false when no consent exists for caller', async () => {
      const isGranted = await manager.isGranted('com.example.mail', 'sendEmail', 'Claude Desktop');

      expect(isGranted).toBe(false);
    });

    it('should return true when tool is granted for specific caller', async () => {
      // Setup: Store consent for Claude Desktop
      const claudeKey = 'consent-Claude Desktop-com.example.mail';
      storageData.set(
        claudeKey,
        JSON.stringify({
          all_tools: false,
          tools: {
            sendEmail: {
              granted: true,
              granted_at: '2026-03-08T10:00:00Z',
              remember: true,
            },
          },
        })
      );

      const isGranted = await manager.isGranted('com.example.mail', 'sendEmail', 'Claude Desktop');

      expect(isGranted).toBe(true);
    });

    it('should return false for different caller even when another caller has consent', async () => {
      // Setup: Store consent for Claude Desktop
      const claudeKey = 'consent-Claude Desktop-com.example.mail';
      storageData.set(
        claudeKey,
        JSON.stringify({
          all_tools: false,
          tools: {
            sendEmail: {
              granted: true,
              granted_at: '2026-03-08T10:00:00Z',
              remember: true,
            },
          },
        })
      );

      // Cursor should not have access
      const isGranted = await manager.isGranted('com.example.mail', 'sendEmail', 'Cursor');

      expect(isGranted).toBe(false);
    });

    it('should return true when all_tools is granted for caller', async () => {
      // Setup: Store "authorize all" for Claude Desktop
      const claudeKey = 'consent-Claude Desktop-com.example.mail';
      storageData.set(
        claudeKey,
        JSON.stringify({
          all_tools: true,
          tools: {},
        })
      );

      const isGranted = await manager.isGranted('com.example.mail', 'anyTool', 'Claude Desktop');

      expect(isGranted).toBe(true);
    });

    it('should handle unknown caller gracefully', async () => {
      const isGranted = await manager.isGranted('com.example.mail', 'sendEmail', 'Unknown Client');

      expect(isGranted).toBe(false);
    });
  });

  describe('checkAndPrompt with caller identity', () => {
    it('should pass caller name to dialog', async () => {
      mockDialog.show = vi.fn(
        async () =>
          ({
            decision: 'tool',
            remember: false,
          }) as ConsentDialogResult
      );

      await manager.checkAndPrompt(
        'com.example.mail',
        'Example Mail',
        { name: 'sendEmail', description: 'Send email', parameters: {} },
        { name: 'Claude Desktop', version: '1.0.0' }
      );

      expect(mockDialog.show).toHaveBeenCalledWith(
        expect.objectContaining({
          callerName: 'Claude Desktop',
        })
      );
    });

    it('should use "Unknown Client" when caller name is empty', async () => {
      mockDialog.show = vi.fn(
        async () =>
          ({
            decision: 'tool',
            remember: false,
          }) as ConsentDialogResult
      );

      await manager.checkAndPrompt(
        'com.example.mail',
        'Example Mail',
        { name: 'sendEmail', description: 'Send email', parameters: {} },
        { name: '', version: '1.0.0' }
      );

      expect(mockDialog.show).toHaveBeenCalledWith(
        expect.objectContaining({
          callerName: 'Unknown Client',
        })
      );
    });

    it('should not show dialog when consent already granted for same caller', async () => {
      // Setup: Pre-grant consent for Claude Desktop
      const claudeKey = 'consent-Claude Desktop-com.example.mail';
      storageData.set(
        claudeKey,
        JSON.stringify({
          all_tools: false,
          tools: {
            sendEmail: {
              granted: true,
              granted_at: '2026-03-08T10:00:00Z',
              remember: true,
            },
          },
        })
      );

      // Should not show dialog
      await manager.checkAndPrompt(
        'com.example.mail',
        'Example Mail',
        { name: 'sendEmail', description: 'Send email', parameters: {} },
        { name: 'Claude Desktop', version: '1.0.0' }
      );

      expect(mockDialog.show).not.toHaveBeenCalled();
    });

    it('should show dialog for different caller even when another caller has consent', async () => {
      // Setup: Pre-grant consent for Claude Desktop
      const claudeKey = 'consent-Claude Desktop-com.example.mail';
      storageData.set(
        claudeKey,
        JSON.stringify({
          all_tools: false,
          tools: {
            sendEmail: {
              granted: true,
              granted_at: '2026-03-08T10:00:00Z',
              remember: true,
            },
          },
        })
      );

      mockDialog.show = vi.fn(
        async () =>
          ({
            decision: 'tool',
            remember: false,
          }) as ConsentDialogResult
      );

      // Cursor should trigger dialog
      await manager.checkAndPrompt(
        'com.example.mail',
        'Example Mail',
        { name: 'sendEmail', description: 'Send email', parameters: {} },
        { name: 'Cursor', version: '2.0.0' }
      );

      expect(mockDialog.show).toHaveBeenCalled();
    });

    it('should store consent with caller-scoped key after user grants', async () => {
      mockDialog.show = vi.fn(
        async () =>
          ({
            decision: 'tool',
            remember: true,
          }) as ConsentDialogResult
      );

      await manager.checkAndPrompt(
        'com.example.mail',
        'Example Mail',
        { name: 'sendEmail', description: 'Send email', parameters: {} },
        { name: 'Claude Desktop', version: '1.0.0' }
      );

      // Verify: Consent is stored with caller-scoped key
      const claudeKey = 'consent-Claude Desktop-com.example.mail';
      expect(storageData.has(claudeKey)).toBe(true);

      const stored = JSON.parse(storageData.get(claudeKey)!);
      expect(stored.tools.sendEmail.granted).toBe(true);
      expect(stored.tools.sendEmail.remember).toBe(true);
    });

    it('should support "authorize all tools" for caller', async () => {
      mockDialog.show = vi.fn(
        async () =>
          ({
            decision: 'all',
            remember: false,
          }) as ConsentDialogResult
      );

      await manager.checkAndPrompt(
        'com.example.mail',
        'Example Mail',
        { name: 'sendEmail', description: 'Send email', parameters: {} },
        { name: 'Claude Desktop', version: '1.0.0' }
      );

      // Verify: all_tools flag is set for this caller
      const claudeKey = 'consent-Claude Desktop-com.example.mail';
      const stored = JSON.parse(storageData.get(claudeKey)!);
      expect(stored.all_tools).toBe(true);

      // Subsequent tool should not trigger dialog
      vi.clearAllMocks();
      await manager.checkAndPrompt(
        'com.example.mail',
        'Example Mail',
        { name: 'readEmail', description: 'Read email', parameters: {} },
        { name: 'Claude Desktop', version: '1.0.0' }
      );

      expect(mockDialog.show).not.toHaveBeenCalled();
    });
  });

  describe('loadRecord and saveRecord', () => {
    it('should load empty record for new caller', async () => {
      const record = await manager['loadRecord']('com.example.mail', 'Claude Desktop');

      expect(record).toEqual({
        all_tools: false,
        tools: {},
      });
    });

    it('should save and load record for specific caller', async () => {
      const record = {
        all_tools: false,
        tools: {
          sendEmail: {
            granted: true,
            granted_at: '2026-03-08T10:00:00Z',
            remember: true,
          },
        },
      };

      await manager['saveRecord']('com.example.mail', 'Claude Desktop', record);
      const loaded = await manager['loadRecord']('com.example.mail', 'Claude Desktop');

      expect(loaded).toEqual(record);
    });

    it('should not share records between callers', async () => {
      const claudeRecord = {
        all_tools: false,
        tools: {
          sendEmail: {
            granted: true,
            granted_at: '2026-03-08T10:00:00Z',
            remember: true,
          },
        },
      };

      await manager['saveRecord']('com.example.mail', 'Claude Desktop', claudeRecord);

      // Cursor should have empty record
      const cursorRecord = await manager['loadRecord']('com.example.mail', 'Cursor');
      expect(cursorRecord).toEqual({
        all_tools: false,
        tools: {},
      });

      // Claude Desktop should have its record
      const loadedClaudeRecord = await manager['loadRecord']('com.example.mail', 'Claude Desktop');
      expect(loadedClaudeRecord).toEqual(claudeRecord);
    });
  });
});
