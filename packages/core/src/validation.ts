import { UploadStuffError } from "./errors";
import type { AnyRouteConfig } from "./router-types";
import type { InitUploadFileData } from "./schemas";
import { getFileSizeInBytes, getValidMimeTypes } from "./utils/helpers";

/**
 * Default cap on files per batch when a route doesn't set `maxFileCount`. A
 * backstop so an unbounded `files[]` can't fan out into unbounded presign /
 * verification work; routes that genuinely need more set `maxFileCount` explicitly.
 * ponytail: 20 is a tuning knob, not a hard ceiling — bump it if real uploads need it.
 */
export const DEFAULT_MAX_FILE_COUNT = 20;

/**
 * Shared file validation run on both the client (pre-flight) and the server
 * (authoritative). Throws an `UploadStuffError` so the HTTP layer maps it to a
 * 400 instead of an unhandled 500.
 */
export const validateFiles = (files: InitUploadFileData[], config: AnyRouteConfig): void => {
  // `??` (not `||`) so an explicit `maxFileCount: 0` still means "reject all".
  const maxFileCount = config.maxFileCount ?? DEFAULT_MAX_FILE_COUNT;
  if (files.length > maxFileCount) {
    throw new UploadStuffError({
      code: "BAD_REQUEST",
      message: `Too many files. Maximum allowed: ${maxFileCount}`,
    });
  }

  const validMimeTypes = getValidMimeTypes(config.type);
  const maxSize = getFileSizeInBytes(config.maxFileSize);

  for (const file of files) {
    if (file.size > maxSize) {
      throw new UploadStuffError({
        code: "BAD_REQUEST",
        message: `File ${file.filename} exceeds maximum size of ${config.maxFileSize}`,
      });
    }

    if (!validMimeTypes.includes(file.contentType)) {
      throw new UploadStuffError({
        code: "BAD_REQUEST",
        message: `File ${file.filename} has unsupported content type: ${file.contentType}`,
      });
    }
  }
};
