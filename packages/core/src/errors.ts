export type UploadStuffErrorCode =
  | "INPUT_VALIDATION_ERROR"
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN";

const uploadStuffErrorCodes = {
  INPUT_VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
} as const satisfies Record<UploadStuffErrorCode, number>;

export class UploadStuffError extends Error {
  public readonly code: UploadStuffErrorCode;
  public readonly status: (typeof uploadStuffErrorCodes)[UploadStuffErrorCode];

  constructor({
    code,
    message,
    cause,
  }: {
    code: UploadStuffErrorCode;
    message: string;
    cause?: unknown;
  }) {
    super(message, { cause });
    this.name = "UploadStuffError";
    this.code = code;
    this.status = uploadStuffErrorCodes[code];

    this.cause ??= cause;
  }
}
