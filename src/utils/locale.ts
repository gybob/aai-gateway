import { execFileSync } from "node:child_process";

export type SupportedLocale = "en" | "zh-CN" | "zh-TW";

/**
 * Get the system locale on macOS
 */
export function getSystemLocale(): SupportedLocale {
  try {
    // On macOS, use defaults to get the locale
    const output = execFileSync(
      "defaults",
      ["read", "-g", "AppleLocale"],
      { encoding: "utf-8", timeout: 1000 }
    ).trim();

    return normalizeLocale(output);
  } catch {
    // Fallback to environment variable
    const envLocale = process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || "en";
    return normalizeLocale(envLocale);
  }
}

/**
 * Normalize locale string to supported format
 */
function normalizeLocale(locale: string): SupportedLocale {
  const lower = locale.toLowerCase().replace(/[^a-z-]/g, "");

  // Chinese variants
  if (lower.startsWith("zh-hans") || lower === "zh-cn" || lower === "zh_cn") {
    return "zh-CN";
  }
  if (lower.startsWith("zh-hant") || lower === "zh-tw" || lower === "zh_tw" || lower === "zh-hk" || lower === "zh_hk") {
    return "zh-TW";
  }
  if (lower.startsWith("zh")) {
    return "zh-CN"; // Default to Simplified Chinese
  }

  // Default to English
  return "en";
}
