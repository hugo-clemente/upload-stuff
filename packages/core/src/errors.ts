/** Error codes the handler maps to HTTP status: 400, 400, 401, 403. */
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

/**
 * Error carrying an {@link UploadStuffErrorCode}. Thrown by the core/handlers
 * and surfaced to the client as a 4xx; `status` is derived from `code`. Throw
 * one from a route's `middleware` to reject a request with a chosen code.
 * (A throw from `createContext` runs outside the mapping wrapper and surfaces
 * as a host 500, so gate auth in `middleware`, not `createContext`.)
 */
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
  }
}
