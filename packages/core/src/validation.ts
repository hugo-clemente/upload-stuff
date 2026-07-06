import { UploadStuffError } from "./errors";
import { matchFileType, type NormalizedRouteConfig } from "./file-types";
import type { InitUploadFileData } from "./schemas";
import { getFileSizeInBytes } from "./utils/helpers";

/**
 * Default for the instance-level `defaultMaxFileCount` option, used to resolve
 * `NormalizedRouteConfig.maxFileCount` (in `normalizeRouteConfig`/UploadStuff) when a
 * route doesn't set `maxFileCount` explicitly. `validateFiles` only ever sees the
 * already-resolved value. A backstop so an unbounded `files[]` can't fan out into
 * unbounded presign / verification work; routes that genuinely need more set
 * `maxFileCount` explicitly.
 * ponytail: 20 is a tuning knob, not a hard ceiling — bump it if real uploads need it.
 */
export const DEFAULT_MAX_FILE_COUNT = 20;

/**
 * Shared file validation run on both the client (pre-flight) and the server
 * (authoritative). Throws an `UploadStuffError` so the HTTP layer maps it to a
 * 400 instead of an unhandled 500.
 */
export const validateFiles = (
  files: InitUploadFileData[],
  config: NormalizedRouteConfig,
): void => {
  if (files.length > config.maxFileCount) {
    throw new UploadStuffError({
      code: "BAD_REQUEST",
      message: `Too many files. Maximum allowed: ${config.maxFileCount}`,
    });
  }

  const bucketCounts = new Map<string, number>();

  for (const file of files) {
    const matched = matchFileType(file.contentType, config);
    if (!matched) {
      throw new UploadStuffError({
        code: "BAD_REQUEST",
        message: `File ${file.filename} has unsupported content type: ${file.contentType}`,
      });
    }

    if (file.size > getFileSizeInBytes(matched.config.maxFileSize)) {
      throw new UploadStuffError({
        code: "BAD_REQUEST",
        message: `File ${file.filename} exceeds maximum size of ${matched.config.maxFileSize}`,
      });
    }

    const count = (bucketCounts.get(matched.key) ?? 0) + 1;
    bucketCounts.set(matched.key, count);
    if (matched.config.maxFileCount !== undefined && count > matched.config.maxFileCount) {
      throw new UploadStuffError({
        code: "BAD_REQUEST",
        message: `Too many files of type ${matched.key}. Maximum allowed: ${matched.config.maxFileCount}`,
      });
    }
  }
};
