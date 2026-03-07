import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ConsentDialog, ConsentDialogInfo, ConsentDialogResult } from './interface.js';
import { getSystemLocale, type SupportedLocale } from '../../utils/locale.js';
import { getTranslations } from '../i18n/translations.js';

const execFileAsync = promisify(execFile);

function buildParamLines(parameters: object, noParamsText: string): string {
  const props =
    (parameters as { properties?: Record<string, { description?: string }> }).properties ?? {};
  return (
    Object.entries(props)
      .map(([k, v]) => `• ${k}${v.description ? `: ${v.description}` : ''}`)
      .join('\\n') || noParamsText
  );
}

export class MacOSConsentDialog implements ConsentDialog {
  private locale: SupportedLocale;

  constructor() {
    this.locale = getSystemLocale();
  }

  async show(info: ConsentDialogInfo): Promise<ConsentDialogResult> {
    const t = getTranslations(this.locale);
    const paramLines = buildParamLines(info.parameters, t.noParams);

    // Build dialog text with caller identity:
    // ⚠️ Claude Desktop requests tool access
    //
    // Caller: Claude Desktop
    // 待授权应用：语雀
    // 待授权接口：get_user
    // 接口说明：获取当前用户信息
    // 接口参数：(无参数)
    const authScript = `
set dialogText to "${t.dialogTitle}

${t.callerLabel}：${info.callerName}
${t.pendingAppLabel}：${info.appName}
${t.pendingApiLabel}：${info.toolName}
${t.apiDescriptionLabel}：${info.toolDescription}
${t.apiParamsLabel}：${paramLines}"
set result to display dialog dialogText buttons {"${t.buttonCancel}", "${t.buttonAuthorizeOnce}", "${t.buttonAuthorizeAll}"} default button "${t.buttonAuthorizeOnce}" with icon caution
set btn to button returned of result
return btn
`.trim();

    let decision: 'tool' | 'all' | 'deny';
    try {
      const { stdout } = await execFileAsync('osascript', ['-e', authScript]);
      const btn = stdout.trim();
      if (btn === t.buttonAuthorizeAll) {
        decision = 'all';
      } else if (btn === t.buttonAuthorizeOnce) {
        decision = 'tool';
      } else {
        decision = 'deny';
      }
    } catch {
      // user clicked Cancel or closed dialog
      decision = 'deny';
    }

    if (decision === 'deny') {
      return { decision: 'deny', remember: false };
    }

    // Ask if user wants to remember the decision
    let remember = false;
    try {
      const rememberMessage = t.rememberDialogTitle.replace('{toolName}', info.toolName);
      const rememberScript = `
set r to display dialog "${rememberMessage}" buttons {"${t.rememberButtonNo}", "${t.rememberButtonYes}"} default button "${t.rememberButtonYes}"
return button returned of r
`.trim();
      const { stdout: remOut } = await execFileAsync('osascript', ['-e', rememberScript]);
      remember = remOut.trim() === t.rememberButtonYes;
    } catch {
      remember = false;
    }

    return { decision, remember };
  }
}
