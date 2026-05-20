import { createId } from "@paralleldrive/cuid2";
import { z } from "zod";

import {
  acceptedFileTypes,
  getFileSizeInBytes,
  type CompleteUploadResult,
  type InitUploadFileData,
  type InitUploadResult,
  type Json,
  type MetadataObject,
  type RouteConfig,
  type UploadStuffConfig,
  type ValidContextObject,
  type ValidMiddlewareObject,
} from "@upload-stuff/core";

interface InitUploadHandler<TFileUsageContext extends string> {
  (params: {
    files: Array<InitUploadFileData>;
    config: RouteConfig<TFileUsageContext>;
    input: Json;
    metadata: MetadataObject;
    middlewareData: ValidMiddlewareObject;
    ctx: ValidContextObject;
    endpoint: string;
  }): Promise<InitUploadResult>;
}

interface CompleteUploadHandler {
  (params: {
    batchId: string;
    ctx: ValidContextObject;
    endpoint: string;
  }): Promise<
    Omit<CompleteUploadResult, "serverData"> & {
      input: Json;
      middlewareData: ValidMiddlewareObject;
    }
  >;
}

const validateFiles = async (
  files: Array<InitUploadFileData>,
  config: RouteConfig<string>,
): Promise<void> => {
  if (config.maxFileCount && files.length > config.maxFileCount) {
    throw new Error(`Too many files. Maximum allowed: ${config.maxFileCount}`);
  }

  for (const file of files) {
    if (file.size > getFileSizeInBytes(config.maxFileSize)) {
      throw new Error(
        `File ${file.filename} exceeds maximum size of ${config.maxFileSize} bytes`,
      );
    }

    const types = Array.isArray(config.type) ? config.type : [config.type];

    // also checks for valid mime type
    if (
      !types.some((type) => acceptedFileTypes[type].includes(file.contentType))
    ) {
      throw new Error(
        `File ${file.filename} has unsupported content type: ${file.contentType}`,
      );
    }
  }
};

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
  } = config;

  const initUpload: InitUploadHandler<TFileUsageContext> = async ({
    files,
    ctx,
    config,
    input,
    metadata,
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
        `Invalid upload session data : ${z.prettifyError(
          uploadSessionDataParse.error,
        )}`,
      );
    }

    await validateFiles(files, config);

    const batchId = createId();

    const uploadPromises = files.map(async (file) => {
      const id = await fileIdGenerator({
        filename: file.filename,
        usageContext: config.usageContext,
      });

      const key = await fileKeyGenerator({
        fileId: id,
        filename: file.filename,
        usageContext: config.usageContext,
      });

      const publicUrl = await filePublicUrlGenerator({
        key,
      });

      const uploadData = await storageAdapter.generatePresignedUpload({
        key,
        contentType: file.contentType,
        size: file.size,
        usageContext: config.usageContext,
        isPublic: config.isPublic,
        userId: ctx.userId,
        entityId: metadata.entityId,
      });

      await databaseAdapter.createFile({
        file: {
          id: id,
          key: key,
          publicUrl: publicUrl,
          filename: file.filename,
          size: file.size,
          contentType: file.contentType,
          uploadedBy: ctx.userId,
          batchId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          uploadSessionData: uploadSessionDataParse.data as any,
          usageContext: config.usageContext,
          isPublic: config.isPublic,
          stored: false,
          entityId: metadata.entityId,
        },
      });

      return {
        id,
        key: key,
        publicUrl: publicUrl,

        contentType: file.contentType,
        filename: file.filename,
        size: file.size,

        uploadUrl: uploadData.uploadUrl,
      };
    });

    const uploadResults = await Promise.all(uploadPromises);

    return {
      files: uploadResults,
      batchId,
    };
  };

  const completeUpload: CompleteUploadHandler = async ({ batchId, ctx }) => {
    // 1. Verify all files were uploaded successfully
    const files = await databaseAdapter.findFilesByBatchIdAndUploadedBy({
      batchId,
      uploadedBy: ctx.userId,
    });

    if (files.length === 0) {
      throw new Error("No files found");
    }

    // 2. Verify each file
    const verificationPromises = files.map(async (file) => {
      const verification = await storageAdapter.verifyUpload({
        key: file.key,
        expectedSize: file.size,
        expectedContentType: file.contentType,
      });

      if (!verification.exists || !verification.isValid) {
        throw new Error(`File verification failed: ${verification.error}`);
      }
    });

    await Promise.all(verificationPromises);

    await databaseAdapter.updateFilesToStored({
      batchId,
      uploadedBy: ctx.userId,
      storedAt: new Date(),
    });

    const uploadSessionDataParse = uploadSessionDataSchema.safeParse(
      files[0]!.uploadSessionData,
    );

    if (!uploadSessionDataParse.success) {
      throw new Error(
        `Invalid upload session data : ${z.prettifyError(uploadSessionDataParse.error)}`,
      );
    }

    const uploadSessionData = uploadSessionDataParse.data;

    return {
      files: files.map((file) => ({
        id: file.id,
        key: file.key,
        publicUrl: file.publicUrl,
        contentType: file.contentType,
        size: file.size,
        filename: file.filename,
      })),
      ctx,
      input: uploadSessionData?.input,
      middlewareData:
        uploadSessionData?.middlewareData as ValidMiddlewareObject,
    };
  };

  return {
    initUpload,
    completeUpload,
  };
};
