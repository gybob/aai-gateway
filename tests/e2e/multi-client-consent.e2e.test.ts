import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConsentManager } from '../../src/consent/manager.js';
import type { SecureStorage } from '../../src/storage/secure-storage/interface.js';
import type { ConsentDialog, ConsentDialogResult } from '../../src/consent/dialog/interface.js';

/**
 * E2E Test: Multi-Client Consent Scenario
 *
 * This test validates that consent is properly isolated between different MCP clients
 * by simulating the full consent flow for multiple clients.
 *
 * Scenario:
 * 1. Claude Desktop grants consent for a tool
 * 2. Cursor tries to use the same tool
 * 3. Verify that Cursor requires its own consent (not reusing Claude's consent)
 * 4. Verify that Claude's consent is still valid for Claude
 */

describe('E2E: Multi-Client Consent Scenario', () => {
  let manager: ConsentManager;
  let mockStorage: Map<string, string>;
  let storage: SecureStorage;
  let dialog: ConsentDialog;

  beforeEach(() => {
    // Create a shared storage instance (simulating persistent storage)
    mockStorage = new Map();

    storage = {
      get: vi.fn(async (key: string) => mockStorage.get(key)),
      set: vi.fn(async (key: string, value: string) => {
        mockStorage.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        mockStorage.delete(key);
      }),
    };

    dialog = {
      show: vi.fn(),
    };

    manager = new ConsentManager(storage, dialog);
  });

  it('should isolate consent between Claude Desktop and Cursor', async () => {
    const appId = 'com.example.mail';
    const appName = 'Example Mail';
    const toolInfo = {
      name: 'sendEmail',
      description: 'Send an email',
      parameters: {},
    };

    // Scenario 1: Claude Desktop grants consent
    (dialog.show as any).mockResolvedValueOnce({
      decision: 'tool',
      remember: true,
    } as ConsentDialogResult);

    await manager.checkAndPrompt(appId, appName, toolInfo, {
      name: 'Claude Desktop',
      version: '1.0.0',
    });

    // Verify Claude's consent is stored
    const claudeKey = 'consent-Claude Desktop-com.example.mail';
    expect(mockStorage.has(claudeKey)).toBe(true);

    // Scenario 2: Cursor tries to use the same tool
    // Should NOT have Claude's consent
    const cursorGranted = await manager.isGranted(appId, toolInfo.name, 'Cursor');
    expect(cursorGranted).toBe(false);

    // Dialog should be shown for Cursor
    (dialog.show as any).mockResolvedValueOnce({
      decision: 'tool',
      remember: true,
    } as ConsentDialogResult);

    await manager.checkAndPrompt(appId, appName, toolInfo, {
      name: 'Cursor',
      version: '2.0.0',
    });

    // Verify Cursor's consent is stored separately
    const cursorKey = 'consent-Cursor-com.example.mail';
    expect(mockStorage.has(cursorKey)).toBe(true);

    // Both consents exist independently
    expect(mockStorage.has(claudeKey)).toBe(true);
    expect(mockStorage.has(cursorKey)).toBe(true);

    // Claude's consent is still valid for Claude
    const claudeGranted = await manager.isGranted(appId, toolInfo.name, 'Claude Desktop');
    expect(claudeGranted).toBe(true);

    // Cursor's consent is valid for Cursor
    const cursorGrantedNow = await manager.isGranted(appId, toolInfo.name, 'Cursor');
    expect(cursorGrantedNow).toBe(true);
  });

  it('should require re-authorization when different client accesses same tool', async () => {
    const appId = 'com.example.mail';
    const toolInfo = {
      name: 'sendEmail',
      description: 'Send an email',
      parameters: {},
    };

    // Pre-grant consent for Claude Desktop
    (dialog.show as any).mockResolvedValueOnce({
      decision: 'tool',
      remember: true,
    } as ConsentDialogResult);

    await manager.checkAndPrompt(appId, 'Example Mail', toolInfo, {
      name: 'Claude Desktop',
      version: '1.0.0',
    });

    // Cursor tries to use the same tool
    // Should require its own consent
    const cursorGranted = await manager.isGranted(appId, toolInfo.name, 'Cursor');
    expect(cursorGranted).toBe(false);

    // Dialog should be shown for Cursor
    (dialog.show as any).mockResolvedValueOnce({
      decision: 'tool',
      remember: true,
    } as ConsentDialogResult);

    await manager.checkAndPrompt(appId, 'Example Mail', toolInfo, {
      name: 'Cursor',
      version: '2.0.0',
    });

    // Verify dialog was called for Cursor (not reusing Claude's consent)
    expect(dialog.show).toHaveBeenCalledTimes(2); // Once for Claude, once for Cursor
  });

  it('should handle multiple clients with different consent decisions', async () => {
    const appId = 'com.example.mail';
    const appName = 'Example Mail';

    // Claude grants "all tools"
    (dialog.show as any).mockResolvedValueOnce({
      decision: 'all',
      remember: false,
    } as ConsentDialogResult);

    await manager.checkAndPrompt(
      appId,
      appName,
      {
        name: 'sendEmail',
        description: 'Send email',
        parameters: {},
      },
      {
        name: 'Claude Desktop',
        version: '1.0.0',
      }
    );

    // Cursor grants only specific tool
    (dialog.show as any).mockResolvedValueOnce({
      decision: 'tool',
      remember: true,
    } as ConsentDialogResult);

    await manager.checkAndPrompt(
      appId,
      appName,
      {
        name: 'sendEmail',
        description: 'Send email',
        parameters: {},
      },
      {
        name: 'Cursor',
        version: '2.0.0',
      }
    );

    // Claude should have all_tools access
    const claudeKey = 'consent-Claude Desktop-com.example.mail';
    const claudeConsent = JSON.parse(mockStorage.get(claudeKey)!);
    expect(claudeConsent.all_tools).toBe(true);

    // Cursor should have only specific tool access
    const cursorKey = 'consent-Cursor-com.example.mail';
    const cursorConsent = JSON.parse(mockStorage.get(cursorKey)!);
    expect(cursorConsent.all_tools).toBe(false);
    expect(cursorConsent.tools.sendEmail.granted).toBe(true);

    // Claude can use any tool without dialog
    const claudeCanReadEmail = await manager.isGranted(appId, 'readEmail', 'Claude Desktop');
    expect(claudeCanReadEmail).toBe(true);

    // Cursor cannot use other tools
    const cursorCanReadEmail = await manager.isGranted(appId, 'readEmail', 'Cursor');
    expect(cursorCanReadEmail).toBe(false);
  });

  it('should maintain consent isolation across server restarts', async () => {
    const appId = 'com.example.mail';
    const toolInfo = {
      name: 'sendEmail',
      description: 'Send an email',
      parameters: {},
    };

    // Grant consent for Claude Desktop
    (dialog.show as any).mockResolvedValueOnce({
      decision: 'tool',
      remember: true,
    } as ConsentDialogResult);

    await manager.checkAndPrompt(appId, 'Example Mail', toolInfo, {
      name: 'Claude Desktop',
      version: '1.0.0',
    });

    // Simulate server restart: Create new manager with same storage
    const newManager = new ConsentManager(storage, dialog);

    // Claude's consent should persist
    const claudeGranted = await newManager.isGranted(appId, toolInfo.name, 'Claude Desktop');
    expect(claudeGranted).toBe(true);

    // Other clients still have no consent
    const cursorGranted = await newManager.isGranted(appId, toolInfo.name, 'Cursor');
    expect(cursorGranted).toBe(false);
  });

  it('should prevent cross-client authorization leakage', async () => {
    const appId = 'com.example.mail';
    const toolInfo = {
      name: 'sendEmail',
      description: 'Send an email',
      parameters: {},
    };

    // Claude denies consent
    (dialog.show as any).mockResolvedValueOnce({
      decision: 'deny',
      remember: true,
    } as ConsentDialogResult);

    try {
      await manager.checkAndPrompt(appId, 'Example Mail', toolInfo, {
        name: 'Claude Desktop',
        version: '1.0.0',
      });
      // Should throw
      expect.fail('Should have thrown consent denied error');
    } catch (error: any) {
      expect(error.code).toBe('CONSENT_REQUIRED');
    }

    // Cursor grants consent
    (dialog.show as any).mockResolvedValueOnce({
      decision: 'tool',
      remember: true,
    } as ConsentDialogResult);

    await manager.checkAndPrompt(appId, 'Example Mail', toolInfo, {
      name: 'Cursor',
      version: '2.0.0',
    });

    // Claude's denial should not affect Cursor
    const cursorGranted = await manager.isGranted(appId, toolInfo.name, 'Cursor');
    expect(cursorGranted).toBe(true);

    // Claude's denial should persist for Claude
    const claudeConsent = JSON.parse(mockStorage.get('consent-Claude Desktop-com.example.mail')!);
    expect(claudeConsent.tools.sendEmail.granted).toBe(false);

    // Cursor's consent should be separate
    const cursorConsent = JSON.parse(mockStorage.get('consent-Cursor-com.example.mail')!);
    expect(cursorConsent.tools.sendEmail.granted).toBe(true);
  });
});
