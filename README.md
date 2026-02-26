# AAI Gateway

Reference implementation of the [AAI Protocol](https://github.com/gybob/aai-protocol) — an MCP server that bridges AI agents to AAI-enabled desktop and web applications. Discovers apps via standard `aai.json` descriptors, invokes them through native IPC or OAuth 2.1 PKCE HTTP, with native consent dialogs and secure credential storage.

## MCP Interface

AAI Gateway exposes three MCP primitives. Agents discover tools progressively through resources — no `tools/list` — to avoid context explosion.

### `resources/list`
Returns all AAI-enabled apps discovered on the current machine.

```json
{
  "resources": [
    { "uri": "app:com.apple.mail", "name": "Mail", "description": "Apple Mail" },
    { "uri": "app:com.notion.id",  "name": "Notion", "description": "Notion desktop" }
  ]
}
```

### `resources/read`
Accepts two URI types:

- **`app:<bundle-id>`** — reads the descriptor for a locally installed desktop app
- **`https://<domain>`** — fetches `/.well-known/aai.json` from a web service (cached 24h)

Returns the full `aai.json` descriptor including the app's tool list and schemas.

### `tools/call`
Tool name format: `<app-id>:<tool-name>`

```json
{
  "name": "com.apple.mail:send_email",
  "arguments": { "to": "alice@example.com", "subject": "Hello", "body": "..." }
}
```

Execution flow:
1. Resolve app descriptor (local registry or web fetch)
2. Validate tool and arguments
3. Show native consent dialog — user approves/denies (remembered per tool or globally)
4. Execute: desktop apps via native IPC, web apps via HTTP with OAuth 2.1 PKCE token
5. Return result

## Platform Support

| Platform | Discovery | IPC Executor | Consent Dialog | Secure Storage |
|----------|-----------|--------------|----------------|----------------|
| macOS    | ✅ | ✅ Apple Events | ✅ osascript | ✅ Keychain |
| Linux    | 🔜 | 🔜 DBus | 🔜 zenity/kdialog | 🔜 libsecret |
| Windows  | 🔜 | 🔜 COM | 🔜 PowerShell | 🔜 Credential Manager |
| Web      | ✅ `.well-known/aai.json` | ✅ HTTP + OAuth 2.1 PKCE | — | ✅ (via platform) |

## Debugging

```bash
aai-gateway --scan     # list AAI-enabled apps on this machine
aai-gateway --version
```

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Links

- [AAI Protocol Spec](https://github.com/gybob/aai-protocol)

## License

MIT
