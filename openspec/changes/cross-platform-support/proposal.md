## Why

AAI Gateway currently only supports macOS, limiting its reach to a single desktop platform. To become a truly cross-platform solution for AI agents to access desktop and web applications, we need to implement support for Windows and Linux, following the same architecture patterns established for macOS.

## What Changes

### Windows Support

- **Discovery**: Scan for apps in `Program Files`, `AppData`, and registry-based installation paths
- **IPC Executor**: Use PowerShell and COM automation for desktop app control
- **Consent Dialog**: PowerShell-based GUI dialog using `System.Windows.Forms`
- **Secure Storage**: Windows Credential Manager via PowerShell

### Linux Support

- **Discovery**: Scan for apps in `/usr/share/applications`, `~/.local/share/applications`, and XDG desktop entries
- **IPC Executor**: Use DBus for desktop app communication
- **Consent Dialog**: `zenity` or `kdialog` for GUI prompts
- **Secure Storage**: `libsecret` or `gnome-keyring` via command-line tools

### Platform Detection

- Update `src/utils/platform.ts` to detect Windows and Linux
- Handle platform-specific path separators and environment variables

## Capabilities

### New Capabilities

- `windows-discovery`: Discover AAI-enabled applications on Windows platform
- `windows-ipc`: Execute desktop app operations via PowerShell/COM on Windows
- `windows-consent-dialog`: Display consent prompts on Windows using PowerShell GUI
- `windows-secure-storage`: Store credentials in Windows Credential Manager
- `linux-discovery`: Discover AAI-enabled applications on Linux platform
- `linux-ipc`: Execute desktop app operations via DBus on Linux
- `linux-consent-dialog`: Display consent prompts on Linux using zenity/kdialog
- `linux-secure-storage`: Store credentials in libsecret/gnome-keyring

### Modified Capabilities

None - this is a new feature addition, not a modification of existing behavior.

## Impact

### New Files

- `src/discovery/windows.ts` - Windows app discovery
- `src/discovery/linux.ts` - Linux app discovery
- `src/executors/ipc/windows.ts` - Windows IPC executor
- `src/executors/ipc/linux.ts` - Linux IPC executor
- `src/consent/dialog/windows.ts` - Windows consent dialog
- `src/consent/dialog/linux.ts` - Linux consent dialog
- `src/storage/secure-storage/windows.ts` - Windows Credential Manager
- `src/storage/secure-storage/linux.ts` - Linux libsecret

### Modified Files

- `src/discovery/index.ts` - Add Windows/Linux factory cases
- `src/executors/ipc/index.ts` - Add Windows/Linux factory cases
- `src/consent/dialog/index.ts` - Add Windows/Linux factory cases
- `src/storage/secure-storage/index.ts` - Add Windows/Linux factory cases
- `src/utils/platform.ts` - Add Windows/Linux detection (if needed)
- `README.md` - Update platform support table
- `package.json` - Update platform-specific dependencies (if any)
