import { createId } from "@paralleldrive/cuid2";

import {
  DEFAULT_MAX_FILE_COUNT,
  DEFAULT_MAX_FILE_SIZE,
  RESERVED_FIELD_NAMES,
  getFileSizeInBytes,
  type FileSize,
} from "@upload-stuff/core";
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

import { pickDeclaredFields } from "./fields";

const resolveUploadWindowSeconds = (value: number | undefined): number => {
  const seconds = value ?? 3600;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 604800) {
    throw new Error(
      `upload-stuff: uploadWindowSeconds must be an integer between 1 and 604800 (got ${value}).`,
    );
  }
  return seconds;
};

const resolveDefaultMaxFileCount = (value: number | undefined): number => {
  const count = value ?? DEFAULT_MAX_FILE_COUNT;
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(
      `upload-stuff: defaultMaxFileCount must be a non-negative integer (got ${value}).`,
    );
  }
  return count;
};

const resolveDefaultMaxFileSize = (value: FileSize | undefined): FileSize => {
  const size = value ?? DEFAULT_MAX_FILE_SIZE;
  if (getFileSizeInBytes(size) <= 0) {
    throw new Error(
      `upload-stuff: defaultMaxFileSize must be greater than 0 bytes (got "${value}").`,
    );
  }
  return size;
};

const defaultFileIdGenerator = createId;
const defaultFileKeyGenerator = (params: {
  fileId: string;
  filename: string;
}) => {
  return `${params.fileId}-${params.filename}`;
};

/**
 * The consumer-facing `uploadStuff.serverUtils` API.
 *
 * Declared as an explicit exported type (rather than
 * `ReturnType<typeof buildServerUtils<TFields>>`) because referencing a
 * non-exported symbol through a typeof instantiation expression inside the
 * exported `UploadStuff` type crashes TypeScript's quick-info serializer with
 * a stack overflow when the alias is hovered from another module (see
 * upload-stuff.quickinfo.test.ts).
 */
export type ServerUtils<TFields extends FieldsDeclaration = Record<never, never>> = {
  /** Delete pending rows (and their storage objects) older than the upload window. */
  cleanUpFiles: () => Promise<void>;
  /** Upload a file from the server, bypassing the presigned browser flow. */
  uploadFile: (params: {
    data: Omit<
      DatabaseFile<TFields>,
      "stored" | "id" | "key" | "storedAt" | "batchId" | "publicUrl" | "uploadSessionData"
    >;
    content: FileUploadContent;
  }) => Promise<DatabaseFile<TFields>>;
  /** Delete files by id from both the database and storage. */
  deleteFiles: (fileIds: string[]) => Promise<void>;
};

const buildServerUtils = <
  TFields extends FieldsDeclaration = Record<never, never>,
>(
  config: UploadStuffConfig<TFields>,
): ServerUtils<TFields> => {
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
        createdAtThreshold: new Date(Date.now() - config.uploadWindowSeconds * 1000),
      });

      await deleteFiles(files.map((file) => file.id));
    },

    uploadFile: async (params: {
      data: Omit<
        DatabaseFile<TFields>,
        "stored" | "id" | "key" | "storedAt" | "batchId" | "publicUrl" | "uploadSessionData"
      >;
      content: FileUploadContent;
    }) => {
      const id = await config.fileIdGenerator({
        filename: params.data.filename,
      });

      const key = await config.fileKeyGenerator({
        fileId: id,
        filename: params.data.filename,
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
          } as DatabaseFile<TFields>,
        ],
      });

      // Pass the raw row data; the storage adapter resolves its own object
      // metadata from the declared `fields` (the core no longer does),
      // so direct server uploads write the same metadata as the presigned flow.
      const fieldValues = pickDeclaredFields(config.fields, params.data as Record<string, unknown>);

      await config.storageAdapter.uploadFile({
        key,
        filename: params.data.filename,
        contentType: params.data.contentType,
        size: params.data.size,
        isPublic: params.data.isPublic,
        fields: fieldValues,
        content: params.content,
      });

      const file = await config.databaseAdapter.updateFile({
        file: {
          id: id,
          stored: true,
          storedAt: new Date(),
        } as Partial<DatabaseFile<TFields>> & { id: string },
      });

      return file;
    },

    deleteFiles,
  };
};

export type UploadStuff<
  TFields extends FieldsDeclaration = Record<never, never>,
> = {
  $types: {
    fields: TFields;
  };
  serverUtils: ServerUtils<TFields>;
  __storageAdapter: StorageAdapter;
  __databaseAdapter: DatabaseAdapter<TFields>;
  __fileIdGenerator: FileIdGenerator;
  __fileKeyGenerator: FileKeyGenerator;
  __filePublicUrlGenerator: FilePublicUrlGenerator;
  /** The declared custom-field declaration, used to filter persisted values. */
  __fields: TFields | undefined;
  __uploadWindowSeconds: number;
  __defaultMaxFileCount: number;
  __defaultMaxFileSize: FileSize;
};

/**
 * Erased instance type used by the internal server layer (handler / fetch-handler),
 * which only consults the `__*` members. `serverUtils` is the consumer-facing API
 * and is intentionally left opaque here: its typed `uploadFile` signature uses
 * `Omit<DatabaseFile<…, TFields>, …>`, which would otherwise block a concrete
 * instance that declares a required custom field from erasing to this type.
 */
export type AnyUploadStuff = Omit<
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  UploadStuff<any>,
  "serverUtils"
> & {
  serverUtils: unknown;
};

/**
 * Create an UploadStuff instance: wires the storage + database adapters and the
 * key/URL generators shared by every route. The custom-`fields` declaration is
 * inferred from this config and carried to the adapters, so their metadata
 * resolvers are typed against it.
 *
 * @throws if a custom field reuses a reserved column name, or a numeric option
 * is out of range (`uploadWindowSeconds` 1–604800, non-negative counts, positive sizes).
 * @example
 * const uploadStuff = UploadStuff({
 *   storageAdapter: s3Adapter({ config, bucket }),
 *   databaseAdapter: prismaAdapter({ prisma }),
 *   filePublicUrlGenerator: ({ key }) => `https://cdn.example.com/${key}`,
 * });
 */
export const UploadStuff = <TFields extends FieldsDeclaration = Record<never, never>>(
  // The `& { fields?: ValidateFieldsDeclaration<TFields> }` intersection blocks
  // declaring a custom field whose name collides with a reserved column (#1) at
  // the type level, while keeping `TFields` inferred from `config.fields`.
  config: CreateUploadStuffConfig<TFields> & {
    fields?: ValidateFieldsDeclaration<TFields>;
  },
): UploadStuff<TFields> => {
    const {
      storageAdapter: storageAdapterFactory,
      databaseAdapter: databaseAdapterFactory,
      fileIdGenerator = defaultFileIdGenerator,
      fileKeyGenerator = defaultFileKeyGenerator,
      filePublicUrlGenerator,
      fields,
      uploadWindowSeconds,
      defaultMaxFileCount,
      defaultMaxFileSize,
    } = config;

    const resolvedUploadWindowSeconds = resolveUploadWindowSeconds(uploadWindowSeconds);
    const resolvedDefaultMaxFileCount = resolveDefaultMaxFileCount(defaultMaxFileCount);
    const resolvedDefaultMaxFileSize = resolveDefaultMaxFileSize(defaultMaxFileSize);

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
    // receives the instance's inferred fields declaration. The marker is type-only;
    // adapters ignore it at runtime.
    const typeInfo = {} as AdapterTypeInfo<TFields>;
    const storageAdapter = storageAdapterFactory(typeInfo);
    const databaseAdapter = databaseAdapterFactory(typeInfo);

    return {
      $types: undefined as unknown as {
        fields: TFields;
      },

      serverUtils: buildServerUtils<TFields>({
        storageAdapter,
        databaseAdapter,
        fileIdGenerator,
        fileKeyGenerator,
        filePublicUrlGenerator,
        fields,
        uploadWindowSeconds: resolvedUploadWindowSeconds,
        defaultMaxFileCount: resolvedDefaultMaxFileCount,
        defaultMaxFileSize: resolvedDefaultMaxFileSize,
      }),

      __storageAdapter: storageAdapter,
      __databaseAdapter: databaseAdapter,

      __fileIdGenerator: fileIdGenerator,
      __fileKeyGenerator: fileKeyGenerator,
      __filePublicUrlGenerator: filePublicUrlGenerator,
      __fields: fields,
      __uploadWindowSeconds: resolvedUploadWindowSeconds,
      __defaultMaxFileCount: resolvedDefaultMaxFileCount,
      __defaultMaxFileSize: resolvedDefaultMaxFileSize,
    };
};
