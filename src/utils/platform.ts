export type SupportedPlatform = "macos" | "linux" | "windows";

export function getCurrentPlatform(): SupportedPlatform {
  switch (process.platform) {
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}
