import type { SetOptional } from "type-fest";

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

/**
 * The resolved value shape for a fields declaration: a `required: true` field
 * becomes a required key, every other field becomes optional.
 */
export type InferFieldValues<TFields extends FieldsDeclaration> = {
  [K in keyof TFields as TFields[K]["required"] extends true ? K : never]: FieldTsType<
    TFields[K]["type"]
  >;
} & {
  [K in keyof TFields as TFields[K]["required"] extends true ? never : K]?: FieldTsType<
    TFields[K]["type"]
  >;
};

export type DatabaseFile<TFileUsageContext extends string> = {
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
  /**
   * Opaque ownership token, owned by the library but never interpreted by it.
   * Scopes batch completion: only a request that re-derives the same value can
   * finalize a batch. `undefined` denotes an anonymous batch. Derive it from the
   * live `ctx` only — see `.scope()`.
   */
  scope?: string;
};

export type DatabaseAdapter<TFileUsageContext extends string = string> = {
  createFiles: (params: { files: DatabaseFile<TFileUsageContext>[] }) => Promise<void>;

  findFilesByBatchIdAndScope: (params: {
    batchId: string;
    /**
     * Scope filter. A defined value matches only that scope's files; an
     * `undefined` value matches only files with no scope (anonymous uploads).
     * Adapters MUST NOT treat `undefined` as "match any scope".
     */
    scope?: string;
  }) => Promise<DatabaseFile<TFileUsageContext>[]>;

  findFilesToCleanUp: (params: {
    createdAtThreshold: Date;
  }) => Promise<{ id: string; key: string }[]>;

  updateFilesToStored: (params: {
    batchId: string;
    /**
     * Scope filter — same semantics as findFilesByBatchIdAndScope:
     * `undefined` matches only anonymous (scopeless) files, never any scope.
     */
    scope?: string;
    storedAt: Date;
  }) => Promise<{ updatedCount: number }>;

  updateFile: (params: {
    file: Partial<DatabaseFile<TFileUsageContext>> & { id: string };
  }) => Promise<DatabaseFile<TFileUsageContext>>;

  deleteFiles: (params: {
    fileIds: string[];
    deleteFromStorage: (fileKeys: string[]) => Promise<void>;
  }) => Promise<void>;
};

export type FileUploadContent = string | Uint8Array;

/**
 * The row data passed to an `objectMetadata` resolver: the opaque `scope`, the
 * base file columns, and the typed declared custom fields.
 */
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
  scope?: string;
} & InferFieldValues<TFields>;

/** Maps a stored file's row onto an object-metadata key/value map. */
export type ObjectMetadataResolver<
  TFileUsageContext extends string,
  TFields extends FieldsDeclaration,
> = (file: ObjectMetadataInput<TFileUsageContext, TFields>) => Record<string, string>;

/**
 * What a storage adapter needs to store an object: the base columns plus the
 * already-resolved object metadata (the core computes it from `objectMetadata`).
 */
export type StorageObjectInfo = {
  key: string;
  contentType: string;
  size: number;
  usageContext: string;
  isPublic: boolean;
  objectMetadata?: Record<string, string>;
};

export type StorageAdapter = {
  generatePresignedUpload: (params: StorageObjectInfo) => Promise<{ uploadUrl: string }>;

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

export type UploadStuffConfig<
  TFileUsageContext extends string,
  TFields extends FieldsDeclaration = Record<never, never>,
> = {
  storageAdapter: StorageAdapter;
  databaseAdapter: DatabaseAdapter<TFileUsageContext>;
  fileIdGenerator: FileIdGenerator;
  fileKeyGenerator: FileKeyGenerator;
  filePublicUrlGenerator: FilePublicUrlGenerator;
  /** Central declaration of the custom columns this instance persists. */
  fields?: TFields;
  /**
   * Resolve object-storage metadata (e.g. S3 `x-amz-meta-*`) from each row,
   * typed against the declared `fields`. The storage adapter writes the result.
   */
  objectMetadata?: ObjectMetadataResolver<TFileUsageContext, TFields>;
};

export type CreateUploadStuffConfig<
  TFileUsageContext extends string,
  TFields extends FieldsDeclaration = Record<never, never>,
> = SetOptional<
  UploadStuffConfig<TFileUsageContext, TFields>,
  "fileIdGenerator" | "fileKeyGenerator"
>;
