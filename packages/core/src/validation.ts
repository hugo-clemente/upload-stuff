import { UploadStuffError } from "./errors";
import type { AnyRouteConfig } from "./router-types";
import type { InitUploadFileData } from "./schemas";
import { acceptedFileTypes, getFileSizeInBytes } from "./utils/helpers";

/**
 * Shared file validation run on both the client (pre-flight) and the server
 * (authoritative). Throws an `UploadStuffError` so the HTTP layer maps it to a
 * 400 instead of an unhandled 500.
 */
export const validateFiles = (files: InitUploadFileData[], config: AnyRouteConfig): void => {
  if (config.maxFileCount && files.length > config.maxFileCount) {
    throw new UploadStuffError({
      code: "BAD_REQUEST",
      message: `Too many files. Maximum allowed: ${config.maxFileCount}`,
    });
  }

  const types = Array.isArray(config.type) ? config.type : [config.type];
  const validMimeTypes = types.flatMap((type) => acceptedFileTypes[type]);
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
