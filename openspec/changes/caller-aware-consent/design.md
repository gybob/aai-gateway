## Context

The AAI Gateway implements a two-phase authorization model:

1. **Gateway Consent**: User authorizes tools at gateway level
2. **App Authorization**: App/OS level authorization (OAuth, TCC, etc.)

Currently, Gateway Consent is stored globally per `(appId, toolName)` without tracking which MCP client made the request. This means:

- User cannot distinguish which client is requesting access
- Authorization granted to Claude is reused for Cursor
- No audit trail of which client accessed which tools

The MCP protocol provides client identification via connection metadata that we can leverage.

## Goals / Non-Goals

**Goals:**

- Identify MCP caller (process name, client type) from connection context
- Store consent decisions keyed by `(callerName, appId, toolName)`
- Display caller name in consent dialog UI
- Require re-authorization when different caller accesses same tool

**Non-Goals:**

- Fine-grained caller verification (cryptographic attestation)
- Remote caller identification (only local MCP clients)
- Revoking consent per-caller (future enhancement)
- Backward compatibility (aai-gateway is unreleased, clean design)

## Technical Design

### 1. Caller Identity Extraction

**Source**: MCP `InitializeRequest` provides `clientInfo`:

```json
{
  "clientInfo": {
    "name": "Claude Desktop",
    "version": "1.0.0"
  }
}
```

**Implementation in `src/mcp/server.ts`**:

```typescript
interface CallerIdentity {
  name: string;        // e.g., "Claude Desktop", "Cursor", "Windsurf"
  version?: string;    // Client version if available
}

// Extract from InitializeRequest
private extractCallerIdentity(request: InitializeRequest): CallerIdentity {
  return {
    name: request.params.clientInfo?.name ?? 'Unknown Client',
    version: request.params.clientInfo?.version,
  };
}
```

### 2. Consent Storage Schema

**Key format**: `consents[callerName][appId]`

```typescript
interface StoredConsents {
  [callerName: string]: {
    [appId: string]: {
      allTools: boolean;
      tools: {
        [toolName: string]: {
          granted: boolean;
          grantedAt: string;
          remember: boolean;
        };
      };
    };
  };
}
```

**Example**:

```json
{
  "Claude Desktop": {
    "com.example.mail": {
      "allTools": false,
      "tools": {
        "sendEmail": {
          "granted": true,
          "grantedAt": "2026-03-05T10:00:00Z",
          "remember": true
        }
      }
    }
  },
  "Cursor": {
    "com.example.mail": {
      "allTools": false,
      "tools": {}
    }
  }
}
```

**Rationale**: Clean nested structure, easy to query. Since aai-gateway is unreleased, no migration needed.

### 3. Consent Dialog UI

**Updated dialog showing caller**:

```
┌─────────────────────────────────────────────────────────────┐
│ ⚠️  Claude Desktop requests tool access                     │  <- NEW
├─────────────────────────────────────────────────────────────┤
│ App: Example Mail (com.example.mail)                        │
│ Claude Desktop wants to use:                                │
│ ... tool description ...                                    │
│ [Authorize Tool]  [Authorize All Tools]  [Deny]             │
└─────────────────────────────────────────────────────────────┘
```

**Rationale**: Clear user-facing indication of which client is requesting access.

### 4. File Changes Summary

| File                               | Changes                                                          |
| ---------------------------------- | ---------------------------------------------------------------- |
| `src/types/consent.ts`             | Add `CallerIdentity` interface                                   |
| `src/mcp/server.ts`                | Extract caller from `InitializeRequest`, pass to consent manager |
| `src/consent/manager.ts`           | Accept `CallerIdentity`, use caller-scoped keys                  |
| `src/consent/dialog/interface.ts`  | Add `callerName` to dialog info                                  |
| `src/consent/dialog/macos.ts`      | Display caller name in dialog                                    |
| `src/consent/i18n/translations.ts` | Add caller-related i18n strings                                  |

### 5. No Migration Needed

Since aai-gateway is not yet released:

- No existing consent data to migrate
- Clean implementation without legacy code paths
- Simpler storage format

### 6. Error Handling

If `clientInfo` is not provided:

- Use `"Unknown Client"` as caller name
- Still store per-caller (allows future proper clients to require re-auth)

## Risks / Trade-offs

| Risk                                                 | Mitigation                                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Caller spoofing: MCP clients could fake `clientInfo` | Document that caller identity is informational only, not security boundary. Real security is at OS level (TCC). |
| Storage bloat: N× more consent entries               | Acceptable trade-off. Consent storage is small.                                                                 |
| User confusion: Why am I being asked again?          | Dialog clearly shows "Cursor wants to use..." vs previous "Claude Desktop"                                      |
