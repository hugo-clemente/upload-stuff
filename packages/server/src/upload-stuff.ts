import { createId } from "@paralleldrive/cuid2";
import { subHours } from "date-fns";

import { RESERVED_FIELD_NAMES } from "@upload-stuff/core";
import type {
  AdapterTypeInfo,
  CreateUploadStuffConfig,
  DatabaseAdapter,
  DatabaseFile,
  FieldsDeclaration,
  FileIdGenerator,
  FileKeyGenerator,
  FilePublicUrlGenerator,
  FileUploadContent,
  StorageAdapter,
  UploadStuffConfig,
  ValidateFieldsDeclaration,
} from "@upload-stuff/core";

const defaultFileIdGenerator = createId;
const defaultFileKeyGenerator = (params: {
  fileId: string;
  filename: string;
  usageContext: string;
}) => {
  return `${params.fileId}-${params.filename}`;
};

const buildServerUtils = <
  TFileUsageContext extends string,
  TFields extends FieldsDeclaration = Record<never, never>,
>(
  config: UploadStuffConfig<TFileUsageContext, TFields>,
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
        DatabaseFile<TFileUsageContext, TFields>,
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
        // `params.data` is `Omit<DatabaseFile<…, TFields>, …>` plus the columns
        // added here; that reconstitutes a full `DatabaseFile`, but TS can't see
        // through `Omit`/spread on the generic `InferFieldValues<TFields>` part,
        // so assert it.
        files: [
          {
            ...params.data,
            id,
            key,
            publicUrl,
            stored: false,
          } as DatabaseFile<TFileUsageContext, TFields>,
        ],
      });

      // Pass the raw row data; the storage adapter resolves its own object
      // metadata from `scope` + the declared `fields` (the core no longer does),
      // so direct server uploads write the same metadata as the presigned flow.
      const declaredFieldNames = Object.keys(config.fields ?? {});
      const fieldValues = Object.fromEntries(
        Object.entries(params.data as Record<string, unknown>).filter(([name]) =>
          declaredFieldNames.includes(name),
        ),
      );

      await config.storageAdapter.uploadFile({
        key,
        filename: params.data.filename,
        contentType: params.data.contentType,
        size: params.data.size,
        usageContext: params.data.usageContext,
        isPublic: params.data.isPublic,
        scope: params.data.scope,
        fields: fieldValues,
        content: params.content,
      });

      const file = await config.databaseAdapter.updateFile({
        file: {
          id: id,
          stored: true,
          storedAt: new Date(),
        } as Partial<DatabaseFile<TFileUsageContext, TFields>> & { id: string },
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
  serverUtils: ReturnType<typeof buildServerUtils<TFileUsageContext, TFields>>;
  __storageAdapter: StorageAdapter;
  __databaseAdapter: DatabaseAdapter<TFileUsageContext, TFields>;
  __fileIdGenerator: FileIdGenerator;
  __fileKeyGenerator: FileKeyGenerator;
  __filePublicUrlGenerator: FilePublicUrlGenerator;
  /** The declared custom-field declaration, used to filter persisted values. */
  __fields: TFields | undefined;
};

/**
 * Erased instance type used by the internal server layer (handler / http-server),
 * which only consults the `__*` members. `serverUtils` is the consumer-facing API
 * and is intentionally left opaque here: its typed `uploadFile` signature uses
 * `Omit<DatabaseFile<…, TFields>, …>`, which would otherwise block a concrete
 * instance that declares a required custom field from erasing to this type.
 */
export type AnyUploadStuff = Omit<
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  UploadStuff<any, any>,
  "serverUtils"
> & {
  serverUtils: unknown;
};

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
    // The `& { fields?: ValidateFieldsDeclaration<TFields> }` intersection blocks
    // declaring a custom field whose name collides with a reserved column (#1) at
    // the type level, while keeping `TFields` inferred from `config.fields`.
    config: CreateUploadStuffConfig<TFileUsageContext, TFields> & {
      fields?: ValidateFieldsDeclaration<TFields>;
    },
  ): UploadStuff<TFileUsageContext, TFields> => {
    const {
      storageAdapter: storageAdapterFactory,
      databaseAdapter: databaseAdapterFactory,
      fileIdGenerator = defaultFileIdGenerator,
      fileKeyGenerator = defaultFileKeyGenerator,
      filePublicUrlGenerator,
      fields,
    } = config;

    // Belt-and-suspenders to the type-level guard above: reject reserved field
    // names at runtime too, so a JS caller (or a cast) can't slip a custom field
    // that would overwrite library-owned columns at insert time.
    if (fields) {
      const reserved = (RESERVED_FIELD_NAMES as readonly string[]).filter((name) =>
        Object.prototype.hasOwnProperty.call(fields, name),
      );
      if (reserved.length > 0) {
        throw new Error(
          `upload-stuff: custom field(s) ${reserved
            .map((name) => `"${name}"`)
            .join(", ")} use a reserved column name. Reserved names: ${RESERVED_FIELD_NAMES.join(
            ", ",
          )}.`,
        );
      }
    }

    // Resolve the adapter factories once, here — this is where each adapter
    // receives the instance's inferred TFileUsageContext/TFields. The marker is
    // type-only; adapters ignore it at runtime.
    const typeInfo = {} as AdapterTypeInfo<TFileUsageContext, TFields>;
    const storageAdapter = storageAdapterFactory(typeInfo);
    const databaseAdapter = databaseAdapterFactory(typeInfo);

    return {
      $types: undefined as unknown as {
        fileUsageContext: TFileUsageContext;
        fields: TFields;
      },

      serverUtils: buildServerUtils<TFileUsageContext, TFields>({
        storageAdapter,
        databaseAdapter,
        fileIdGenerator,
        fileKeyGenerator,
        filePublicUrlGenerator,
        fields,
      }),

      __storageAdapter: storageAdapter,
      __databaseAdapter: databaseAdapter,

      __fileIdGenerator: fileIdGenerator,
      __fileKeyGenerator: fileKeyGenerator,
      __filePublicUrlGenerator: filePublicUrlGenerator,
      __fields: fields,
    };
  };
