## 1. Type Definitions

- [x] 1.1 Add `CallerIdentity` interface to `src/types/consent.ts` with `name` and `version` fields
- [x] 1.2 Update `StoredConsent` interface to nest by callerName first
## 2. MCP Server Changes
- [x] 2.1 Extract caller identity from MCP `InitializeRequest.clientInfo` in `src/mcp/server.ts`
- [x] 2.2 Store caller identity in server context for use during tool execution
- [x] 2.3 Pass caller identity to `ConsentManager.checkAndPrompt()` method
## 3. Consent Manager Updates
- [x] 3.1 Update `ConsentManager.checkAndPrompt()` to accept `callerIdentity` parameter
- [x] 3.2 Modify consent key generation to include `callerName`
- [x] 3.3 Update `saveConsent()` to store with caller-scoped key
- [x] 3.4 Update `loadConsent()` to use caller-scoped key
## 4. Consent Dialog UI
- [x] 4.1 Update `CredentialDialogInfo` interface to include `callerName` field
- [x] 4.2 Modify macOS dialog to display caller name in title and body
- [x] 4.3 Update i18n translations with caller-related strings
## 5. Windows Discovery
- [x] 5.1 Create `src/discovery/windows.ts` implementing `DesktopDiscovery`
- [x] 5.2 Implement PowerShell-based file scanning for `aai.json`
- [x] 5.3 Scan standard paths: Program Files, AppData
- [x] 5.4 Parse discovered descriptors and filter by `platform: "windows"`
- [x] 5.5 Add unit tests for Windows discovery
## 6. Windows IPC Executor
- [x] 6.1 Create `src/executors/ipc/windows.ts` implementing `IpcExecutor`
- [x] 6.2 Implement PowerShell COM automation execution
- [x] 6.3 Add timeout handling (30s default)
- [x] 6.4 Parse JSON response from COM result
- [x] 6.5 Add error handling for COM failures
- [x] 6.6 Add unit tests for Windows IPC
## 7. Windows Consent Dialog
- [x] 7.1 Create `src/consent/dialog/windows.ts` implementing `ConsentDialog`
- [x] 7.2 Implement PowerShell MessageBox dialog
- [x] 7.3 Add three-button support (Authorize Once/All/Deny)
- [x] 7.4 Implement remember decision follow-up dialog
- [x] 7.5 Add i18n support for dialog text
- [x] 7.6 Add unit tests for Windows consent dialog
## 8. Windows Secure Storage
- [x] 8.1 Create `src/storage/secure-storage/windows.ts` implementing `SecureStorage`
- [x] 8.2 Implement `cmdkey` for credential storage
- [x] 8.3 Implement PowerShell/.NET for credential retrieval (CredRead)
- [x] 8.4 Implement credential deletion
- [x] 8.5 Add unit tests for Windows secure storage
## 9. Linux Discovery
- [x] 9.1 Create `src/discovery/linux.ts` implementing `DesktopDiscovery`
- [x] 9.2 Implement find command for `.desktop` files
- [x] 9.3 Parse `X-AAI-Config` from desktop entries
- [x] 9.4 Scan XDG paths: /usr/share/applications, ~/.local/share/applications
- [x] 9.5 Parse discovered descriptors and filter by `platform: "linux"`
- [x] 9.6 Add unit tests for Linux discovery
## 10. Linux IPC Executor
- [x] 10.1 Create `src/executors/ipc/linux.ts` implementing `IpcExecutor`
- [x] 10.2 Implement DBus method invocation via `gdbus`
- [x] 10.3 Add timeout handling (30s default)
- [x] 10.4 Parse JSON response from DBus result
- [x] 10.5 Add error handling for DBus failures
- [x] 10.6 Add unit tests for Linux IPC
## 11. Linux Consent Dialog
- [x] 11.1 Create `src/consent/dialog/linux.ts` implementing `ConsentDialog`
- [x] 11.2 Implement zenity dialog support
- [x] 11.3 Implement kdialog fallback support
- [x] 11.4 Add detection for available dialog tools
- [x] 11.5 Add i18n support for dialog text
- [x] 11.6 Add unit tests for Linux consent dialog
## 12. Linux Secure Storage
- [x] 12.1 Create `src/storage/secure-storage/linux.ts` implementing `SecureStorage`
- [x] 12.2 Implement `secret-tool` for credential storage
- [x] 12.3 Implement credential retrieval
- [x] 12.4 Implement credential deletion
- [x] 12.5 Add detection for `secret-tool` availability
- [x] 12.6 Add unit tests for Linux secure storage
## 13. Factory Updates
- [x] 13.1 Update `src/discovery/index.ts` to return Windows/Linux implementations
- [x] 13.2 Update `src/executors/ipc/index.ts` to return Windows/Linux implementations
- [x] 13.3 Update `src/consent/dialog/index.ts` to return Windows/Linux implementations
- [x] 13.4 Update `src/storage/secure-storage/index.ts` to return Windows/Linux implementations
- [x] 13.5 Remove NOT_IMPLEMENTED errors for Windows/Linux
## 14. Documentation
- [ ] 14.1 Update README platform support table
- [ ] 14.2 Document Windows-specific requirements (PowerShell execution policy)
- [ ] 14.3 Document Linux-specific requirements (zenity/kdialog, libsecret)
- [ ] 14.4 Update AGENTS.md with Windows/Linux implementation notes
## 15. Testing
- [ ] 15.1 Add integration tests for Windows discovery
- [ ] 15.2 Add integration tests for Linux discovery
- [ ] 15.3 Add E2E test for full Windows flow
- [ ] 15.4 Add E2E test for full Linux flow
- [ ] 15.5 Verify all unit tests pass on all platforms
