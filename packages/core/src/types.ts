/* oxlint-disable @typescript-eslint/no-explicit-any */
import type { Json } from "./utils/types";

/** Declared custom-field value types. */
export type FieldType = "string" | "number" | "boolean";

export type FieldAttributes = {
  type: FieldType;
  required?: boolean;
};

/**
 * A consumer's central declaration of the custom columns persisted alongside
 * the library's own state-machine columns. Declared once on the `UploadStuff`
 * config; values are provided per route by `.fields()`.
 */
export type FieldsDeclaration = Record<string, FieldAttributes>;

type FieldTsType<T extends FieldType> = T extends "string"
  ? string
  : T extends "number"
    ? number
    : T extends "boolean"
      ? boolean
      : never;

/** True only for the `any` type. */
type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * The resolved value shape for a fields declaration: a `required: true` field
 * becomes a required key, every other field becomes optional.
 *
 * `any` is mapped to `Record<string, any>` rather than the literal mapped types:
 * the erased `UploadStuff<any, any>` (`AnyUploadStuff`) flows `any` in here, and
 * the naive mapping would otherwise collapse to a `string | number | boolean`
 * index signature that conflicts with the base row's `uploadSessionData: Json`
 * and breaks assignability of every concrete instance to `AnyUploadStuff`.
 */
export type InferFieldValues<TFields extends FieldsDeclaration> =
  IsAny<TFields> extends true
    ? Record<string, any>
    : {
        [K in keyof TFields as TFields[K]["required"] extends true ? K : never]: FieldTsType<
          TFields[K]["type"]
        >;
      } & {
        [K in keyof TFields as TFields[K]["required"] extends true ? never : K]?: FieldTsType<
          TFields[K]["type"]
        >;
      };

/**
 * Library-owned columns present on every persisted file row. A custom field may
 * not reuse one of these names: at insert time the resolved field values are
 * spread alongside these columns, so a collision would let a `.fields()` value
 * overwrite the library's own state (the `stored` completion flag, the `batchId`
 * grouping, …) and corrupt the upload lifecycle.
 */
export const RESERVED_FIELD_NAMES = [
  "id",
  "key",
  "filename",
  "size",
  "publicUrl",
  "contentType",
  "uploadSessionData",
  "usageContext",
  "isPublic",
  "stored",
  "storedAt",
  "createdAt",
  "batchId",
] as const;

export type ReservedFieldName = (typeof RESERVED_FIELD_NAMES)[number];

/**
 * Type-level guard for a fields declaration: if a declared key collides with a
 * reserved column name, that key's value type becomes an error-message string
 * (not a `FieldAttributes`), so the declaration fails to type-check at the
 * `UploadStuff({ fields })` call site. Valid declarations pass through unchanged.
 */
export type ValidateFieldsDeclaration<TFields extends FieldsDeclaration> = {
  [K in keyof TFields]: K extends ReservedFieldName
    ? `Error: "${K & string}" is a reserved column name and cannot be used as a custom field`
    : TFields[K];
};

export type DatabaseFile<
  TFileUsageContext extends string,
  TFields extends FieldsDeclaration = Record<never, never>,
> = {
  id: string;
  key: string;
  filename: string;
  size: number;
  publicUrl: string;
  contentType: string;
  uploadSessionData?: Json;
  usageContext: TFileUsageContext;
  isPublic: boolean;
  stored: boolean;
  storedAt?: Date;
  batchId?: string;
  /** Set by the store on insert (DB default); present on reads, absent on writes. */
  createdAt?: Date;
} & InferFieldValues<TFields>;

export type DatabaseAdapter<
  TFileUsageContext extends string = string,
  TFields extends FieldsDeclaration = Record<never, never>,
> = {
  createFiles: (params: { files: DatabaseFile<TFileUsageContext, TFields>[] }) => Promise<void>;

  findFilesByBatchId: (params: {
    batchId: string;
  }) => Promise<DatabaseFile<TFileUsageContext, TFields>[]>;

  findFilesToCleanUp: (params: {
    createdAtThreshold: Date;
  }) => Promise<{ id: string; key: string }[]>;

  updateFilesToStored: (params: {
    batchId: string;
    storedAt: Date;
  }) => Promise<{ updatedCount: number }>;

  updateFile: (params: {
    file: Partial<DatabaseFile<TFileUsageContext, TFields>> & { id: string };
  }) => Promise<DatabaseFile<TFileUsageContext, TFields>>;

  deleteFiles: (params: {
    fileIds: string[];
    deleteFromStorage: (fileKeys: string[]) => Promise<void>;
  }) => Promise<void>;
};

export type FileUploadContent = string | Uint8Array;

/** The row data passed to an `objectMetadata` resolver: the base file columns and the typed declared custom fields. */
export type ObjectMetadataInput<
  TFileUsageContext extends string,
  TFields extends FieldsDeclaration,
> = {
  key: string;
  filename: string;
  size: number;
  contentType: string;
  usageContext: TFileUsageContext;
  isPublic: boolean;
} & InferFieldValues<TFields>;

/** Maps a stored file's row onto an object-metadata key/value map. */
export type ObjectMetadataResolver<
  TFileUsageContext extends string,
  TFields extends FieldsDeclaration,
> = (file: ObjectMetadataInput<TFileUsageContext, TFields>) => Record<string, string>;

/**
 * What a storage adapter needs to store an object: the raw row data including
 * the resolved custom `fields`. An adapter that supports object metadata resolves
 * it from this via its own `objectMetadata` option (the core no longer pre-resolves it).
 */
export type StorageObjectInfo = {
  key: string;
  filename: string;
  contentType: string;
  size: number;
  usageContext: string;
  isPublic: boolean;
  /** Resolved custom-field values, already filtered to the declared keys. */
  fields: Record<string, unknown>;
};

export type StorageAdapter = {
  generatePresignedUpload: (params: StorageObjectInfo) => Promise<{
    uploadUrl: string;
    /**
     * Headers the client MUST send on the PUT for the request to match the
     * signature. When the adapter writes object metadata, the presigned URL signs
     * the corresponding metadata headers (e.g. S3 `x-amz-meta-*`); the client has
     * to replay them verbatim or storage rejects the upload. `Content-Type` is
     * handled separately by the client and is not included here.
     */
    requiredHeaders?: Record<string, string>;
  }>;

  uploadFile: (
    params: StorageObjectInfo & {
      content: FileUploadContent;
    },
  ) => Promise<{ key: string }>;

  verifyUpload: (params: {
    key: string;
    expectedSize: number;
    expectedContentType: string;
    clientEtag?: string;
  }) => Promise<{
    exists: boolean;
    isValid: boolean;
    error?: string;
    etag?: string;
    actualSize?: number;
    lastModified?: Date;
  }>;

  deleteFile: (params: { key: string; throwIfNotFound?: boolean }) => Promise<void>;

  batchDeleteFiles: (params: { fileKeys: string[]; throwIfError?: boolean }) => Promise<void>;
};

/**
 * Phantom marker carrying an instance's resolved `TFileUsageContext` and
 * `TFields` to an adapter factory. Adapters are supplied to `UploadStuff(...)` as
 * factories `(info) => adapter`; the library calls the factory once with this
 * marker, so the factory's type parameters are inferred from the `UploadStuff`
 * config instead of being passed explicitly. It holds no runtime data.
 */
export type AdapterTypeInfo<
  TFileUsageContext extends string = string,
  TFields extends FieldsDeclaration = Record<never, never>,
> = {
  readonly __fileUsageContext?: TFileUsageContext;
  readonly __fields?: TFields;
};

/** A storage adapter as supplied to `UploadStuff(...)`. `TFields` rides on the
 * marker so an adapter's typed `objectMetadata` option is inferred. */
export type StorageAdapterFactory<
  TFileUsageContext extends string = string,
  TFields extends FieldsDeclaration = Record<never, never>,
> = (info: AdapterTypeInfo<TFileUsageContext, TFields>) => StorageAdapter;

/** A database adapter as supplied to `UploadStuff(...)`; its types are inferred
 * from the marker the library passes. */
export type DatabaseAdapterFactory<
  TFileUsageContext extends string = string,
  TFields extends FieldsDeclaration = Record<never, never>,
> = (info: AdapterTypeInfo<TFileUsageContext, TFields>) => DatabaseAdapter<TFileUsageContext, TFields>;

export type FileKeyGenerator = (params: {
  fileId: string;
  filename: string;
  usageContext: string;
}) => string | Promise<string>;

export type FileIdGenerator = (params: {
  filename: string;
  usageContext: string;
}) => string | Promise<string>;

export type FilePublicUrlGenerator = (params: { key: string }) => string | Promise<string>;

/**
 * The resolved, internal config the server layer operates on after the adapter
 * factories have been called. Consumers never construct this directly — they pass
 * a `CreateUploadStuffConfig` (with adapter *factories*) to `UploadStuff(...)`.
 */
export type UploadStuffConfig<
  TFileUsageContext extends string,
  TFields extends FieldsDeclaration = Record<never, never>,
> = {
  storageAdapter: StorageAdapter;
  databaseAdapter: DatabaseAdapter<TFileUsageContext, TFields>;
  fileIdGenerator: FileIdGenerator;
  fileKeyGenerator: FileKeyGenerator;
  filePublicUrlGenerator: FilePublicUrlGenerator;
  /** Central declaration of the custom columns this instance persists. */
  fields?: TFields;
};

/**
 * The config a consumer passes to `UploadStuff(...)`. Adapters are supplied as
 * factories so their `TFileUsageContext`/`TFields` are inferred from this config
 * (no explicit generics at the call site). `NoInfer` keeps `TFields` fixed by the
 * central `fields` declaration rather than letting an adapter pin it to `{}`.
 */
export type CreateUploadStuffConfig<
  TFileUsageContext extends string,
  TFields extends FieldsDeclaration = Record<never, never>,
> = {
  storageAdapter: StorageAdapterFactory<TFileUsageContext, NoInfer<TFields>>;
  databaseAdapter: DatabaseAdapterFactory<TFileUsageContext, NoInfer<TFields>>;
  fileIdGenerator?: FileIdGenerator;
  fileKeyGenerator?: FileKeyGenerator;
  filePublicUrlGenerator: FilePublicUrlGenerator;
  /** Central declaration of the custom columns this instance persists. */
  fields?: TFields;
};
