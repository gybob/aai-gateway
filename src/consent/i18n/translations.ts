import type { SupportedLocale } from "../../utils/locale.js";

export interface ConsentDialogTranslations {
  dialogTitle: string;
  appLabel: string;
  requestPermissionLabel: string;
  parametersLabel: string;
  noParameters: string;
  buttonDeny: string;
  buttonAuthorizeTool: string;
  buttonAuthorizeAll: string;
  rememberDialogTitle: string;
  rememberButtonNo: string;
  rememberButtonYes: string;
}

const en: ConsentDialogTranslations = {
  dialogTitle: "⚠️ Tool Authorization Request",
  appLabel: "App",
  requestPermissionLabel: "Agent requests permission to use:",
  parametersLabel: "Parameters:",
  noParameters: "(no parameters)",
  buttonDeny: "Deny",
  buttonAuthorizeTool: "Authorize Tool",
  buttonAuthorizeAll: "Authorize All",
  rememberDialogTitle: "Remember this decision for '{toolName}'?",
  rememberButtonNo: "No",
  rememberButtonYes: "Yes",
};

const zhCN: ConsentDialogTranslations = {
  dialogTitle: "⚠️ 工具授权请求",
  appLabel: "应用",
  requestPermissionLabel: "智能体请求使用：",
  parametersLabel: "参数：",
  noParameters: "(无参数)",
  buttonDeny: "拒绝",
  buttonAuthorizeTool: "授权工具",
  buttonAuthorizeAll: "全部授权",
  rememberDialogTitle: "记住对「{toolName}」的授权决定？",
  rememberButtonNo: "否",
  rememberButtonYes: "是",
};

const zhTW: ConsentDialogTranslations = {
  dialogTitle: "⚠️ 工具授權請求",
  appLabel: "應用程式",
  requestPermissionLabel: "智慧代理請求使用：",
  parametersLabel: "參數：",
  noParameters: "(無參數)",
  buttonDeny: "拒絕",
  buttonAuthorizeTool: "授權工具",
  buttonAuthorizeAll: "全部授權",
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
