/* oxlint-disable @typescript-eslint/no-explicit-any */
import type { FileSize } from "./utils/helpers";
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
 * the erased `UploadStuff<any>` (`AnyUploadStuff`) flows `any` in here, and
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

/** A persisted file row: the library-owned columns plus the instance's typed custom `fields`. */
export type DatabaseFile<TFields extends FieldsDeclaration = Record<never, never>> = {
  id: string;
  key: string;
  filename: string;
  size: number;
  publicUrl: string;
  contentType: string;
  uploadSessionData?: Json;
  isPublic: boolean;
  stored: boolean;
  storedAt?: Date;
  batchId?: string;
  /**
   * Upload-init timestamp. Stamped by the library on the rows it passes to
   * `createFiles`, and read back to enforce the completion window and cleanup —
   * so the deadline never depends on a DB default the adapter might not surface.
   * Adapters must round-trip it like any other library-owned column.
   */
  createdAt?: Date;
} & InferFieldValues<TFields>;

/**
 * File-metadata store. Implement this to persist rows somewhere other than the
 * shipped Prisma adapter. Methods that return full rows must round-trip every
 * library-owned column of {@link DatabaseFile} — including `createdAt` (the
 * completion window reads it back) and any declared custom `fields`
 * (`findFilesToCleanUp` is the exception: it returns only `{ id, key }`).
 */
export type DatabaseAdapter<TFields extends FieldsDeclaration = Record<never, never>> = {
  /** Insert the given rows (called at init with `stored: false`). */
  createFiles: (params: { files: DatabaseFile<TFields>[] }) => Promise<void>;

  /** Return every row of a batch, in any order. Empty array if none. */
  findFilesByBatchId: (params: { batchId: string }) => Promise<DatabaseFile<TFields>[]>;

  /** Return abandoned rows to reap: `stored: false` and `createdAt <= createdAtThreshold`. */
  findFilesToCleanUp: (params: {
    createdAtThreshold: Date;
  }) => Promise<{ id: string; key: string }[]>;

  /**
   * Atomically flip a batch's still-pending (`stored: false`) rows to stored.
   * The `stored: false` guard is required: a concurrent/repeated completion must
   * update 0 rows, and `updatedCount` reports how many it flipped.
   */
  updateFilesToStored: (params: {
    batchId: string;
    storedAt: Date;
  }) => Promise<{ updatedCount: number }>;

  /** Patch one row by `id` and return the full updated row. */
  updateFile: (params: {
    file: Partial<DatabaseFile<TFields>> & { id: string };
  }) => Promise<DatabaseFile<TFields>>;

  /**
   * Delete rows by id. Must call `deleteFromStorage` with their keys *before*
   * removing the rows so a storage failure leaves the rows for a retry — deleting
   * rows first would strand the objects as unreachable orphans.
   */
  deleteFiles: (params: {
    fileIds: string[];
    deleteFromStorage: (fileKeys: string[]) => Promise<void>;
  }) => Promise<void>;
};

export type FileUploadContent = string | Uint8Array;

/** The row data passed to an `objectMetadata` resolver: the base file columns and the typed declared custom fields. */
export type ObjectMetadataInput<TFields extends FieldsDeclaration> = {
  key: string;
  filename: string;
  size: number;
  contentType: string;
  isPublic: boolean;
} & InferFieldValues<TFields>;

/** Maps a stored file's row onto an object-metadata key/value map. */
export type ObjectMetadataResolver<TFields extends FieldsDeclaration> = (
  file: ObjectMetadataInput<TFields>,
) => Record<string, string>;

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
  isPublic: boolean;
  /** Resolved custom-field values, already filtered to the declared keys. */
  fields: Record<string, unknown>;
};

/**
 * Object-storage backend. Implement this to target a store other than the
 * shipped S3 adapter. Methods should throw on unexpected failures (network,
 * credentials, 5xx) so they surface as retryable 500s — reserve the typed
 * "not found"/"invalid" results below for the client's own fault.
 */
export type StorageAdapter = {
  /**
   * Return a presigned URL the browser PUTs the file to directly, valid for
   * `expiresInSeconds`. `requiredHeaders` are headers the client MUST replay on
   * the PUT for the signature to match (e.g. signed `x-amz-meta-*`); omit when
   * none beyond `Content-Type` are signed.
   */
  generatePresignedUpload: (params: StorageObjectInfo & { expiresInSeconds: number }) => Promise<{
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

  /**
   * Upload `content` server-side (bypassing the presigned flow), writing the
   * same object metadata as {@link StorageAdapter.generatePresignedUpload}.
   * Returns the stored object key.
   */
  uploadFile: (
    params: StorageObjectInfo & {
      content: FileUploadContent;
    },
  ) => Promise<{ key: string }>;

  /**
   * Check the stored object matches what was promised at init. `exists: false`
   * means the client never uploaded; `isValid: false` with `error` means a size/
   * content-type/etag mismatch. Both are client faults, not throws.
   */
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

  /**
   * Delete one object. Idempotent by default; when `throwIfNotFound` is set, a
   * missing key must throw.
   */
  deleteFile: (params: { key: string; throwIfNotFound?: boolean }) => Promise<void>;

  /**
   * Delete many objects. An empty list is a no-op. When `throwIfError` is set,
   * any per-object failure must throw (used by cleanup so the DB rows survive a
   * partial storage failure); otherwise failures are logged and swallowed.
   */
  batchDeleteFiles: (params: { fileKeys: string[]; throwIfError?: boolean }) => Promise<void>;
};

/**
 * Phantom marker carrying an instance's resolved `TFields` to an adapter
 * factory. Adapters are supplied to `UploadStuff(...)` as
 * factories `(info) => adapter`; the library calls the factory once with this
 * marker, so the factory's type parameters are inferred from the `UploadStuff`
 * config instead of being passed explicitly. It holds no runtime data.
 */
export type AdapterTypeInfo<TFields extends FieldsDeclaration = Record<never, never>> = {
  readonly __fields?: TFields;
};

/** A storage adapter as supplied to `UploadStuff(...)`. `TFields` rides on the
 * marker so an adapter's typed `objectMetadata` option is inferred. */
export type StorageAdapterFactory<
  TFields extends FieldsDeclaration = Record<never, never>,
> = (info: AdapterTypeInfo<TFields>) => StorageAdapter;

/** A database adapter as supplied to `UploadStuff(...)`; its types are inferred
 * from the marker the library passes. */
export type DatabaseAdapterFactory<
  TFields extends FieldsDeclaration = Record<never, never>,
> = (info: AdapterTypeInfo<TFields>) => DatabaseAdapter<TFields>;

export type FileKeyGenerator = (params: {
  fileId: string;
  filename: string;
}) => string | Promise<string>;

export type FileIdGenerator = (params: { filename: string }) => string | Promise<string>;

export type FilePublicUrlGenerator = (params: { key: string }) => string | Promise<string>;

/**
 * The resolved, internal config the server layer operates on after the adapter
 * factories have been called. Consumers never construct this directly — they pass
 * a `CreateUploadStuffConfig` (with adapter *factories*) to `UploadStuff(...)`.
 */
export type UploadStuffConfig<TFields extends FieldsDeclaration = Record<never, never>> = {
  storageAdapter: StorageAdapter;
  databaseAdapter: DatabaseAdapter<TFields>;
  fileIdGenerator: FileIdGenerator;
  fileKeyGenerator: FileKeyGenerator;
  filePublicUrlGenerator: FilePublicUrlGenerator;
  /** Central declaration of the custom columns this instance persists. */
  fields?: TFields;
  /** Window (seconds) for presign expiry, completion deadline, and cleanup. */
  uploadWindowSeconds: number;
  defaultMaxFileCount: number;
  defaultMaxFileSize: FileSize;
};

/**
 * The config a consumer passes to `UploadStuff(...)`. Adapters are supplied as
 * factories so their `TFields` are inferred from this config (no explicit
 * generics at the call site). `NoInfer` keeps `TFields` fixed by the
 * central `fields` declaration rather than letting an adapter pin it to `{}`.
 */
export type CreateUploadStuffConfig<TFields extends FieldsDeclaration = Record<never, never>> = {
  storageAdapter: StorageAdapterFactory<NoInfer<TFields>>;
  databaseAdapter: DatabaseAdapterFactory<NoInfer<TFields>>;
  fileIdGenerator?: FileIdGenerator;
  fileKeyGenerator?: FileKeyGenerator;
  filePublicUrlGenerator: FilePublicUrlGenerator;
  /** Central declaration of the custom columns this instance persists. */
  fields?: TFields;
  /** Window in seconds (default 3600, 1..604800) for presign expiry, completion
   * deadline, and abandoned-row cleanup. */
  uploadWindowSeconds?: number;
  defaultMaxFileCount?: number;
  defaultMaxFileSize?: FileSize;
};
