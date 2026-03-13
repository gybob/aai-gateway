import type { SupportedLocale } from "../../utils/locale.js";

export interface ConsentDialogTranslations {
  dialogTitle: string;
  callerLabel: string;
  appLabel: string;
  toolLabel: string;
  toolDescriptionLabel: string;
  buttonCancel: string;
  buttonAuthorizeOnce: string;
  buttonAuthorizeAll: string;
  rememberDialogTitle: string;
  rememberButtonNo: string;
  rememberButtonYes: string;
}

const en: ConsentDialogTranslations = {
  dialogTitle: "🤖 Agent Authorization Request",
  callerLabel: "Caller",
  appLabel: "App",
  toolLabel: "Tool",
  toolDescriptionLabel: "Description",
  buttonCancel: "Cancel",
  buttonAuthorizeOnce: "Authorize This Tool",
  buttonAuthorizeAll: "Authorize All Tools for This App",
  rememberDialogTitle: "Remember this decision for '{toolName}'?",
  rememberButtonNo: "No",
  rememberButtonYes: "Yes",
};

const zhCN: ConsentDialogTranslations = {
  dialogTitle: "🤖 智能体授权请求",
  callerLabel: "调用方",
  appLabel: "应用",
  toolLabel: "工具",
  toolDescriptionLabel: "工具说明",
  buttonCancel: "取消",
  buttonAuthorizeOnce: "仅授权此工具",
  buttonAuthorizeAll: "授权该应用所有工具",
  rememberDialogTitle: "记住对「{toolName}」的授权决定？",
  rememberButtonNo: "否",
  rememberButtonYes: "是",
};

const zhTW: ConsentDialogTranslations = {
  dialogTitle: "🤖 智慧代理授權請求",
  callerLabel: "呼叫方",
  appLabel: "應用程式",
  toolLabel: "工具",
  toolDescriptionLabel: "工具說明",
  buttonCancel: "取消",
  buttonAuthorizeOnce: "僅授權此工具",
  buttonAuthorizeAll: "授權該應用程式所有工具",
  rememberDialogTitle: "記住對「{toolName}」的授權決定？",
  rememberButtonNo: "否",
  rememberButtonYes: "是",
};

const translations: Record<SupportedLocale, ConsentDialogTranslations> = {
  en,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
};

export function getTranslations(locale: SupportedLocale): ConsentDialogTranslations {
  return translations[locale] ?? translations.en;
}
