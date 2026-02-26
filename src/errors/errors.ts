export type AaiErrorCode =
  | "INVALID_REQUEST"
  | "UNKNOWN_APP"
  | "UNKNOWN_TOOL"
  | "INVALID_PARAMS"
  | "CONSENT_REQUIRED"
  | "AUTH_REQUIRED"
  | "AUTH_DENIED"
  | "AUTH_EXPIRED"
  | "AUTH_INVALID"
  | "TIMEOUT"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR"
  | "NOT_IMPLEMENTED";

export interface ConsentRequiredData {
  app_id: string;
  app_name: string;
  tool: string;
  tool_description: string;
  tool_parameters: object;
  consent_url: string;
}

export class AaiError extends Error {
  constructor(
    public readonly code: AaiErrorCode,
    message: string,
    public readonly data?: object
  ) {
    super(message);
    this.name = "AaiError";
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AaiError);
    }
  }

  static isAaiError(err: unknown): err is AaiError {
    return err instanceof AaiError;
  }
}
