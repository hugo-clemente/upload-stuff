/* eslint-disable @typescript-eslint/no-explicit-any */
import { createId } from "@paralleldrive/cuid2";
import { subHours } from "date-fns";

import type {
  CreateUploadStuffConfig,
  DatabaseFile,
  FileUploadContent,
  UploadStuffConfig,
} from "@upload-stuff/core";

const defaultFileIdGenerator = createId;
const defaultFileKeyGenerator = (params: {
  fileId: string;
  filename: string;
  usageContext: string;
}) => {
  return `${params.fileId}-${params.filename}`;
};

export const UploadStuff = <TFileUsageContext extends string>({
  storageAdapter,
  databaseAdapter,
  fileIdGenerator = defaultFileIdGenerator,
  fileKeyGenerator = defaultFileKeyGenerator,
  filePublicUrlGenerator,
}: CreateUploadStuffConfig<TFileUsageContext>) => {
  return {
    $types: undefined as unknown as {
      fileUsageContext: TFileUsageContext;
    },

    serverUtils: buildServerUtils({
      storageAdapter,
      databaseAdapter,
      fileIdGenerator,
      fileKeyGenerator,
      filePublicUrlGenerator,
    }),

    __storageAdapter: storageAdapter,
    __databaseAdapter: databaseAdapter,

    __fileIdGenerator: fileIdGenerator,
    __fileKeyGenerator: fileKeyGenerator,
    __filePublicUrlGenerator: filePublicUrlGenerator,
  };
};

const buildServerUtils = <TFileUsageContext extends string>(
  config: UploadStuffConfig<TFileUsageContext>,
) => {
  const deleteFiles = async (fileIds: string[]) => {
    await config.databaseAdapter.deleteFiles({
      fileIds,
      deleteFromStorage: async (fileKeys: string[]) => {
        await config.storageAdapter.batchDeleteFiles({ fileKeys });
      },
    });
  };

  return {
    cleanUpFiles: async () => {
      const files = await config.databaseAdapter.findFilesToCleanUp({
        createdAtThreshold: subHours(new Date(), 24),
      });

      await deleteFiles(files.map((file) => file.id));
    },

    uploadFile: async (params: {
      data: Omit<
        DatabaseFile<TFileUsageContext>,
        | "stored"
        | "id"
        | "key"
        | "storedAt"
        | "batchId"
        | "publicUrl"
        | "uploadSessionData"
      >;
      content: FileUploadContent;
    }) => {
      const id = await config.fileIdGenerator({
        filename: params.data.filename,
        usageContext: params.data.usageContext,
      });

      const key = await config.fileKeyGenerator({
        fileId: id,
        filename: params.data.filename,
        usageContext: params.data.usageContext,
      });

      const publicUrl = await config.filePublicUrlGenerator({
        key,
      });

      await config.databaseAdapter.createFiles({
        files: [
          {
            ...params.data,
            id,
            key,
            publicUrl,
            stored: false,
          },
        ],
      });

      await config.storageAdapter.uploadFile({
        key,
        contentType: params.data.contentType,
        size: params.data.size,
        usageContext: params.data.usageContext,
        entityId: params.data.entityId,
        userId: params.data.uploadedBy,
        isPublic: params.data.isPublic,

        content: params.content,
      });

      const file = await config.databaseAdapter.updateFile({
        file: {
          id: id,
          stored: true,
          storedAt: new Date(),
        },
      });

      return file;
    },

    deleteFiles,
  };
};

export type UploadStuff<TFileUsageContext extends string> = ReturnType<
  typeof UploadStuff<TFileUsageContext>
>;

export type AnyUploadStuff = UploadStuff<any>;
