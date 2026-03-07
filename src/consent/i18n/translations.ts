import type { SupportedLocale } from "../../utils/locale.js";

export interface ConsentDialogTranslations {
  dialogTitle: string;
  callerLabel: string;  // "Caller" or "调用方"
  pendingAppLabel: string;
  pendingApiLabel: string;
  apiDescriptionLabel: string;
  apiParamsLabel: string;
  noParams: string;
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
  pendingAppLabel: "Pending App",
  pendingApiLabel: "Pending API",
  apiDescriptionLabel: "Description",
  apiParamsLabel: "Parameters",
  noParams: "(none)",
  buttonCancel: "Cancel",
  buttonAuthorizeOnce: "Authorize This API",
  buttonAuthorizeAll: "Authorize All APIs for This App",
  rememberDialogTitle: "Remember this decision for '{toolName}'?",
  rememberButtonNo: "No",
  rememberButtonYes: "Yes",
};

const zhCN: ConsentDialogTranslations = {
  dialogTitle: "🤖 智能体授权请求",
  callerLabel: "调用方",
  pendingAppLabel: "待授权应用",
  pendingApiLabel: "待授权接口",
  apiDescriptionLabel: "接口说明",
  apiParamsLabel: "接口参数",
  noParams: "(无参数)",
  buttonCancel: "取消",
  buttonAuthorizeOnce: "仅授权此接口",
  buttonAuthorizeAll: "授权该应用所有接口",
  rememberDialogTitle: "记住对「{toolName}」的授权决定？",
  rememberButtonNo: "否",
  rememberButtonYes: "是",
};

const zhTW: ConsentDialogTranslations = {
  dialogTitle: "🤖 智慧代理授權請求",
  callerLabel: "呼叫方",
  pendingAppLabel: "待授權應用程式",
  pendingApiLabel: "待授權接口",
  apiDescriptionLabel: "接口說明",
  apiParamsLabel: "接口參數",
  noParams: "(無參數)",
  buttonCancel: "取消",
  buttonAuthorizeOnce: "僅授權此接口",
  buttonAuthorizeAll: "授權該應用程式所有接口",
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
