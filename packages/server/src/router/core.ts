import { createId } from "@paralleldrive/cuid2";
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

interface InitUploadHandler<TFileUsageContext extends string> {
  (params: {
    files: Array<InitUploadFileData>;
    config: RouteConfig<TFileUsageContext>;
    input: Json;
    scope: string | undefined;
    fieldValues: Record<string, unknown>;
    middlewareData: ValidMiddlewareObject;
    endpoint: string;
  }): Promise<InitUploadResult>;
}

interface CompleteUploadHandler {
  (params: { batchId: string; scope: string | undefined; endpoint: string }): Promise<
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
    objectMetadata,
    fields,
  } = config;

  // The fields declaration is the authoritative persisted shape. Filter every
  // `.fields()` result down to declared keys before it reaches the row, so a
  // stray/typo key from the resolver can't be forwarded as an unknown column,
  // and a value can never collide with a library-owned column.
  const declaredFieldNames = Object.keys(fields ?? {});
  const pickDeclaredFields = (values: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(values).filter(([key]) => declaredFieldNames.includes(key)));

  const initUpload: InitUploadHandler<TFileUsageContext> = async ({
    files,
    config,
    input,
    scope,
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

    const batchId = createId();

    const safeFieldValues = pickDeclaredFields(fieldValues);

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
            contentType: file.contentType,
            size: file.size,
            usageContext: config.usageContext,
            isPublic: config.isPublic,
            objectMetadata: objectMetadata?.({
              key,
              filename: file.filename,
              size: file.size,
              contentType: file.contentType,
              usageContext: config.usageContext,
              isPublic: config.isPublic,
              scope,
              ...safeFieldValues,
            }),
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
        scope,
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
      batchId,
    };
  };

  const completeUpload: CompleteUploadHandler = async ({ batchId, scope, endpoint }) => {
    const files = await databaseAdapter.findFilesByBatchIdAndScope({
      batchId,
      scope,
    });

    if (files.length === 0) {
      throw new UploadStuffError({
        code: "BAD_REQUEST",
        message: "No files found",
      });
    }

    const uploadSessionDataParse = uploadSessionDataSchema.safeParse(files[0]!.uploadSessionData);

    if (!uploadSessionDataParse.success) {
      throw new UploadStuffError({
        code: "BAD_REQUEST",
        message: `Invalid upload session data : ${z.prettifyError(uploadSessionDataParse.error)}`,
      });
    }

    const uploadSessionData = uploadSessionDataParse.data;

    // Guard against finalising a batch through a different endpoint than the
    // one it was initialised on — otherwise the wrong route's onUploadComplete
    // would run against these files.
    if (uploadSessionData.endpoint !== endpoint) {
      throw new UploadStuffError({
        code: "BAD_REQUEST",
        message: `Batch ${batchId} does not belong to endpoint ${endpoint}`,
      });
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

    // `updateFilesToStored` only matches rows still `stored: false`, so a
    // repeated or concurrent completion updates 0 rows. That signals the batch
    // was already finalised and `onUploadComplete` must not run again.
    const { updatedCount } = await databaseAdapter.updateFilesToStored({
      batchId,
      scope,
      storedAt: new Date(),
    });

    return {
      files: files.map((file) => ({
        id: file.id,
        key: file.key,
        publicUrl: file.publicUrl,
        contentType: file.contentType,
        size: file.size,
        filename: file.filename,
      })),
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
