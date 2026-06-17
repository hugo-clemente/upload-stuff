import { createId } from "@paralleldrive/cuid2";
import { subHours } from "date-fns";

import type {
  CreateUploadStuffConfig,
  DatabaseAdapter,
  DatabaseFile,
  FieldsDeclaration,
  FileIdGenerator,
  FileKeyGenerator,
  FilePublicUrlGenerator,
  FileUploadContent,
  ObjectMetadataResolver,
  StorageAdapter,
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

const buildServerUtils = <TFileUsageContext extends string>(
  config: UploadStuffConfig<TFileUsageContext>,
) => {
  const deleteFiles = async (fileIds: string[]) => {
    await config.databaseAdapter.deleteFiles({
      fileIds,
      deleteFromStorage: async (fileKeys: string[]) => {
        // throwIfError so a partial storage failure aborts the DB deletion —
        // otherwise the rows vanish while the objects survive as orphans.
        await config.storageAdapter.batchDeleteFiles({ fileKeys, throwIfError: true });
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
        "stored" | "id" | "key" | "storedAt" | "batchId" | "publicUrl" | "uploadSessionData"
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

      // DB row first (stored: false): if the storage upload below fails, this
      // row is exactly what cleanUpFiles finds and reclaims. Uploading to
      // storage first would leave an undiscoverable orphan object whenever the
      // row insert fails.
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
        isPublic: params.data.isPublic,
        // Note: the typed `objectMetadata` resolver runs on the presigned-upload
        // flow; this direct server-upload path does not apply it.

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

export type UploadStuff<
  TFileUsageContext extends string,
  TFields extends FieldsDeclaration = Record<never, never>,
> = {
  $types: {
    fileUsageContext: TFileUsageContext;
    fields: TFields;
  };
  serverUtils: ReturnType<typeof buildServerUtils<TFileUsageContext>>;
  __storageAdapter: StorageAdapter;
  __databaseAdapter: DatabaseAdapter<TFileUsageContext>;
  __fileIdGenerator: FileIdGenerator;
  __fileKeyGenerator: FileKeyGenerator;
  __filePublicUrlGenerator: FilePublicUrlGenerator;
  __objectMetadata: ObjectMetadataResolver<TFileUsageContext, TFields> | undefined;
};

// oxlint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyUploadStuff = UploadStuff<any, any>;

/**
 * Create an UploadStuff instance. Curried so the file-usage-context union can be
 * given explicitly while the custom-`fields` declaration is inferred from the
 * config (TypeScript can't partially infer generics in a single call).
 *
 * ```ts
 * const uploadStuff = UploadStuff<"avatar" | "document">()({ ...config });
 * ```
 */
export const UploadStuff =
  <TFileUsageContext extends string = string>() =>
  <TFields extends FieldsDeclaration = Record<never, never>>(
    config: CreateUploadStuffConfig<TFileUsageContext, TFields>,
  ): UploadStuff<TFileUsageContext, TFields> => {
    const {
      storageAdapter,
      databaseAdapter,
      fileIdGenerator = defaultFileIdGenerator,
      fileKeyGenerator = defaultFileKeyGenerator,
      filePublicUrlGenerator,
      objectMetadata,
    } = config;

    return {
      $types: undefined as unknown as {
        fileUsageContext: TFileUsageContext;
        fields: TFields;
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
      __objectMetadata: objectMetadata,
    };
  };
