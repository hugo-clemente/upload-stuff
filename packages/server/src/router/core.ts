import { z } from "zod";

import {
  UploadStuffError,
  validateFiles,
  type CompleteUploadResult,
  type InitUploadFileData,
  type InitUploadResult,
  type Json,
  type RouteConfig,
  type UploadStuffConfig,
  type ValidMiddlewareObject,
} from "@upload-stuff/core";

import { pickDeclaredFields } from "../fields";

interface InitUploadHandler<TFileUsageContext extends string> {
  (params: {
    files: Array<InitUploadFileData>;
    config: RouteConfig<TFileUsageContext>;
    input: Json;
    fieldValues: Record<string, unknown>;
    middlewareData: ValidMiddlewareObject;
    endpoint: string;
  }): Promise<InitUploadResult>;
}

// Web Crypto (globalThis.crypto), not node:crypto, so @upload-stuff/server still
// bundles/imports on fetch-compatible runtimes (Cloudflare Workers, Next Edge,
// Deno, Bun) that have no Node built-ins. Available on Node >= 20 too.
const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // btoa is a runtime-neutral global; strip padding and make it URL-safe.
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const createBatchToken = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
};
const hashBatchToken = async (token: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
};

interface CompleteUploadHandler {
  (params: { batchToken: string; endpoint: string }): Promise<
    Omit<CompleteUploadResult, "serverData"> & {
      input: Json;
      middlewareData: ValidMiddlewareObject;
      /**
       * True when this batch was already finalised by an earlier completion.
       * The caller must skip `onUploadComplete` to avoid duplicate side-effects.
       */
      alreadyCompleted: boolean;
    }
  >;
}

const uploadSessionDataSchema = z.object({
  input: z.json(),
  middlewareData: z.json(),
  endpoint: z.string(),
});

export const createCore = <TFileUsageContext extends string>(
  config: UploadStuffConfig<TFileUsageContext>,
) => {
  const {
    storageAdapter,
    databaseAdapter,
    fileKeyGenerator,
    fileIdGenerator,
    filePublicUrlGenerator,
    fields,
    uploadWindowSeconds,
  } = config;

  const initUpload: InitUploadHandler<TFileUsageContext> = async ({
    files,
    config,
    input,
    fieldValues,
    middlewareData,
    endpoint,
  }) => {
    const uploadSessionDataParse = uploadSessionDataSchema.safeParse({
      input: input,
      middlewareData: middlewareData,
      endpoint,
    });

    if (!uploadSessionDataParse.success) {
      throw new Error(
        `Invalid upload session data : ${z.prettifyError(uploadSessionDataParse.error)}`,
      );
    }

    validateFiles(files, config);

    const batchToken = createBatchToken();
    const batchId = await hashBatchToken(batchToken);
    // Stamp the init time here, in the library, rather than relying on a DB
    // default the adapter might not surface on reads. The completion window and
    // cleanup both read this back, so the deadline never silently disappears.
    const createdAt = new Date();

    const safeFieldValues = pickDeclaredFields(fields, fieldValues);

    const preparedFiles = await Promise.all(
      files.map(async (file) => {
        const id = await fileIdGenerator({
          filename: file.filename,
          usageContext: config.usageContext,
        });

        const key = await fileKeyGenerator({
          fileId: id,
          filename: file.filename,
          usageContext: config.usageContext,
        });

        const [publicUrl, uploadData] = await Promise.all([
          filePublicUrlGenerator({ key }),
          storageAdapter.generatePresignedUpload({
            key,
            filename: file.filename,
            contentType: file.contentType,
            size: file.size,
            usageContext: config.usageContext,
            isPublic: config.isPublic,
            // Raw declared field values; the storage adapter resolves its own
            // object metadata from these (the core no longer pre-resolves it).
            fields: safeFieldValues,
            expiresInSeconds: uploadWindowSeconds,
          }),
        ]);

        return {
          file,
          id,
          key,
          publicUrl,
          uploadUrl: uploadData.uploadUrl,
          uploadHeaders: uploadData.requiredHeaders,
        };
      }),
    );

    await databaseAdapter.createFiles({
      files: preparedFiles.map(({ file, id, key, publicUrl }) => ({
        id,
        key,
        publicUrl,
        filename: file.filename,
        size: file.size,
        contentType: file.contentType,
        batchId,
        // oxlint-disable-next-line @typescript-eslint/no-explicit-any
        uploadSessionData: uploadSessionDataParse.data as any,
        usageContext: config.usageContext,
        isPublic: config.isPublic,
        stored: false,
        createdAt,
        // Declared custom columns ride along structurally; the adapter passes
        // them through (the persisted schema must declare them). Already filtered
        // to declared keys, so this can't overwrite a library-owned column above.
        ...safeFieldValues,
      })),
    });

    return {
      files: preparedFiles.map(({ file, id, key, publicUrl, uploadUrl, uploadHeaders }) => ({
        id,
        key,
        publicUrl,
        contentType: file.contentType,
        filename: file.filename,
        size: file.size,
        uploadUrl,
        uploadHeaders,
      })),
      batchToken,
    };
  };

  const completeUpload: CompleteUploadHandler = async ({ batchToken, endpoint }) => {
    const batchId = await hashBatchToken(batchToken);
    const files = await databaseAdapter.findFilesByBatchId({ batchId });

    if (files.length === 0) {
      throw new UploadStuffError({ code: "BAD_REQUEST", message: "No files found" });
    }

    const uploadSessionDataParse = uploadSessionDataSchema.safeParse(files[0]!.uploadSessionData);
    if (!uploadSessionDataParse.success) {
      throw new UploadStuffError({
        code: "BAD_REQUEST",
        message: `Invalid upload session data : ${z.prettifyError(uploadSessionDataParse.error)}`,
      });
    }
    const uploadSessionData = uploadSessionDataParse.data;

    // Prevents finalising a batch through a different endpoint than it was
    // initialised on — otherwise the wrong route's onUploadComplete would run.
    if (uploadSessionData.endpoint !== endpoint) {
      throw new UploadStuffError({
        code: "BAD_REQUEST",
        message: `Batch does not belong to endpoint ${endpoint}`,
      });
    }

    const mappedFiles = files.map((file) => ({
      id: file.id,
      key: file.key,
      publicUrl: file.publicUrl,
      contentType: file.contentType,
      size: file.size,
      filename: file.filename,
    }));

    // Already finalised: return the idempotent result BEFORE the window check, so
    // a retry of a completed upload still succeeds even past the window.
    if (files.every((file) => file.stored)) {
      return {
        files: mappedFiles,
        input: uploadSessionData.input,
        middlewareData: uploadSessionData.middlewareData as ValidMiddlewareObject,
        alreadyCompleted: true,
      };
    }

    // Reject a stale pending batch. Use the earliest row createdAt so the result
    // never depends on adapter row ordering. The core stamps createdAt at init,
    // so a pending batch that can't produce one means the adapter dropped a
    // library-owned column — fail closed rather than skip the deadline. (The
    // `instanceof Date` guard also turns a non-Date createdAt into "absent"
    // instead of a `.getTime()` crash.)
    const createdAtMs = files
      .map((file) => (file.createdAt instanceof Date ? file.createdAt.getTime() : undefined))
      .filter((ms): ms is number => typeof ms === "number");
    if (createdAtMs.length === 0) {
      throw new UploadStuffError({ code: "BAD_REQUEST", message: "Cannot determine upload age" });
    }
    if (Date.now() - Math.min(...createdAtMs) > uploadWindowSeconds * 1000) {
      throw new UploadStuffError({ code: "BAD_REQUEST", message: "Upload window expired" });
    }

    const verificationPromises = files.map(async (file) => {
      const verification = await storageAdapter.verifyUpload({
        key: file.key,
        expectedSize: file.size,
        expectedContentType: file.contentType,
      });
      if (!verification.exists || !verification.isValid) {
        throw new UploadStuffError({
          code: "BAD_REQUEST",
          message: `File verification failed: ${verification.error}`,
        });
      }
    });
    await Promise.all(verificationPromises);

    // The `stored: false` match makes a repeated/concurrent completion update 0 rows,
    // signalling an already-finalised batch.
    const { updatedCount } = await databaseAdapter.updateFilesToStored({
      batchId,
      storedAt: new Date(),
    });

    if (updatedCount === 0) {
      // We read the batch as pending but transitioned 0 rows. Either a
      // concurrent completion already finalised it (idempotent success) or the
      // rows were deleted (e.g. cleanup reaping an expired batch) between our
      // read and this update. Returning success for vanished files would be
      // silent data loss reported as 200, so re-read to tell them apart.
      const current = await databaseAdapter.findFilesByBatchId({ batchId });
      if (current.length === 0 || !current.every((file) => file.stored)) {
        throw new UploadStuffError({ code: "BAD_REQUEST", message: "Batch is no longer available" });
      }
    }

    return {
      files: mappedFiles,
      input: uploadSessionData.input,
      middlewareData: uploadSessionData.middlewareData as ValidMiddlewareObject,
      alreadyCompleted: updatedCount === 0,
    };
  };

  return {
    initUpload,
    completeUpload,
  };
};
