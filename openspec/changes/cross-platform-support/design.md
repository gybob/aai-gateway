## Context

AAI Gateway currently implements platform-specific functionality only for macOS:

- **Discovery**: Scans `/Applications` for `.app` bundles with `aai.json`
- **IPC Executor**: Uses AppleScript/Apple Events via `osascript`
- **Consent Dialog**: Uses `osascript` with `display dialog`
- **Secure Storage**: Uses `security` CLI for Keychain access

To support Windows and Linux, we need to implement equivalent functionality using platform-native tools while maintaining the same interfaces.

## Goals / Non-Goals

**Goals:**

- Implement Windows support using PowerShell and COM automation
- Implement Linux support using DBus and standard desktop tools
- Maintain identical interfaces to macOS implementations
- Handle platform-specific edge cases gracefully
- Update factory functions to return correct implementations per platform

**Non-Goals:**

- Windows Registry-based app discovery (too complex, use file system)
- Linux package manager integration (dpkg, rpm, etc.)
- GUI toolkit dependencies (use command-line tools only)
- Cross-platform build tooling changes

## Decisions

### D1: Windows Discovery Strategy

**Decision**: Scan standard installation directories for `aai.json` files.

**Paths to scan**:

- `C:\Program Files\*\aai.json`
- `C:\Program Files (x86)\*\aai.json`
- `%LOCALAPPDATA%\Programs\*\aai.json`
- `%APPDATA%\*\aai.json` (user-installed apps)

**Implementation**:

```typescript
// Use PowerShell to find files
const findCmd = `Get-ChildItem -Path "${paths}" -Recurse -Filter "aai.json" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName`;
```

**Rationale**: PowerShell is pre-installed on Windows, no external dependencies needed.

**Alternatives Considered**:

- Registry scanning: More accurate but complex, requires Win32 API
- WMI queries: Overkill for file discovery

### D2: Windows IPC Executor

**Decision**: Use PowerShell with COM automation.

**Implementation**:

```typescript
// COM object invocation pattern
const script = `
  $com = New-Object -ComObject "${appId}"
  $result = $com.InvokeTool('${toolName}', '${jsonArgs}')
  $result | ConvertTo-Json -Depth 10
`;
```

**Rationale**: COM is the standard Windows automation mechanism, similar to AppleScript on macOS.

**Alternatives Considered**:

- Named pipes: Lower level, requires custom protocol
- HTTP localhost: Requires app to run HTTP server

### D3: Windows Consent Dialog

**Decision**: Use PowerShell with `System.Windows.Forms`.

**Implementation**:

```typescript
const script = `
  Add-Type -AssemblyName System.Windows.Forms
  $result = [System.Windows.Forms.MessageBox]::Show(
    "${message}",
    "${title}",
    [System.Windows.Forms.MessageBoxButtons]::YesNoCancel,
    [System.Windows.Forms.MessageBoxIcon]::Warning
  )
  $result.ToString()
`;
```

**Rationale**: Built-in .NET, no external dependencies.

**Alternatives Considered**:

- `msg` command: Too limited, no custom buttons
- HTA dialog: Deprecated technology

### D4: Windows Secure Storage

**Decision**: Use PowerShell with Windows Credential Manager via `cmdkey`.

**Implementation**:

```typescript
// Store credential
await execAsync(`cmdkey /generic:aai-gateway/${account} /user:${account} /pass:${value}`);

// Retrieve credential (requires additional .NET code)
const script = `
  Add-Type -AssemblyName System.Runtime.InteropServices
  # ... P/Invoke to advapi32.dll CredRead ...
`;
```

**Rationale**: Windows Credential Manager is the standard secure storage mechanism.

**Alternatives Considered**:

- DPAPI encrypted files: Less standard
- Registry encrypted values: Not designed for secrets

### D5: Linux Discovery Strategy

**Decision**: Scan XDG desktop entry directories for `.desktop` files with `aai.json`.

**Paths to scan**:

- `/usr/share/applications/*.desktop`
- `/usr/local/share/applications/*.desktop`
- `~/.local/share/applications/*.desktop`
- Look for `X-AAI-Config=...` in `.desktop` files pointing to `aai.json`

**Implementation**:

```typescript
// Use find command (similar to macOS)
const findCmd = `find ${paths} -name "*.desktop" -exec grep -l "X-AAI-Config" {} \\;`;
```

**Rationale**: Follows XDG standards, works across desktop environments.

### D6: Linux IPC Executor

**Decision**: Use DBus for inter-process communication.

**Implementation**:

```typescript
// DBus call via gdbus or qdbus
const cmd = `gdbus call --session --dest ${appId} --object-path /app --method com.aai.InvokeTool '${jsonArgs}'`;
```

**Rationale**: DBus is the standard Linux IPC mechanism.

**Alternatives Considered**:

- Unix sockets: Lower level, requires custom protocol
- HTTP localhost: Requires app to run HTTP server

### D7: Linux Consent Dialog

**Decision**: Use `zenity` (GNOME) or `kdialog` (KDE) with fallback ordering.

**Implementation**:

```typescript
// Try zenity first, then kdialog
const zenityCmd = `zenity --question --title="${title}" --text="${message}" --ok-label="Authorize" --cancel-label="Deny"`;
const kdialogCmd = `kdialog --yesno "${message}" --title "${title}"`;
```

**Rationale**: zenity is widely available, kdialog for KDE systems.

**Alternatives Considered**:

- Native GUI toolkit (GTK/Qt): Requires compiled dependencies
- Terminal prompts: Not user-friendly

### D8: Linux Secure Storage

**Decision**: Use `secret-tool` (libsecret CLI) with fallback to encrypted file.

**Implementation**:

```typescript
// Store via secret-tool
await execAsync(`secret-tool store --label="aai-gateway" account ${account} value ${value}`);

// Retrieve
const { stdout } = await execAsync(`secret-tool search account ${account}`);
```

**Rationale**: libsecret is the modern GNOME standard.

**Alternatives Considered**:

- `pass` (password-store): Requires GPG setup
- Encrypted file with device-specific key: Less standard

## Risks / Trade-offs

| Risk                                         | Mitigation                                          |
| -------------------------------------------- | --------------------------------------------------- |
| PowerShell execution policy blocking scripts | Use `-ExecutionPolicy Bypass` flag                  |
| zenity/kdialog not installed                 | Provide clear error message, document requirements  |
| DBus session not available                   | Check for DBus availability, provide helpful error  |
| Windows COM registration varies by app       | Document expected COM interface for app developers  |
| Linux desktop environment fragmentation      | Test on GNOME and KDE, use xdg-utils where possible |
| Credential Manager API complexity            | Use simplified cmdkey for basic operations          |

## Implementation Order

1. **Windows** (higher priority - larger user base)
   - Discovery → Consent Dialog → Secure Storage → IPC Executor

2. **Linux** (secondary priority)
   - Discovery → Consent Dialog → Secure Storage → IPC Executor
