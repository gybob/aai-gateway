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
## 5. Documentation
- [x] 5.1 Update `aai-protocol/spec/security.md` with caller-aware consent flow
- [x] 5.2 Update README to mention per-caller consent behavior
## 6. Testing
- [x] 6.1 Add unit tests for caller identity extraction
- [x] 6.2 Add unit tests for caller-scoped consent storage
- [x] 6.3 Add E2E test for multi-client consent scenario
