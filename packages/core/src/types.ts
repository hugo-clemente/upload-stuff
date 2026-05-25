import type { SetOptional } from "type-fest";

import type { Json } from "./utils/types";

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
  uploadedBy?: string;
  entityId?: string;
};

export type DatabaseAdapter<TFileUsageContext extends string = string> = {
  createFiles: (params: { files: DatabaseFile<TFileUsageContext>[] }) => Promise<void>;

  findFilesByBatchIdAndUploadedBy: (params: {
    batchId: string;
    /**
     * Owner filter. A defined value matches only that owner's files; an
     * `undefined` value matches only files with no owner (anonymous uploads).
     * Adapters MUST NOT treat `undefined` as "match any owner".
     */
    uploadedBy?: string;
  }) => Promise<DatabaseFile<TFileUsageContext>[]>;

  findFilesToCleanUp: (params: {
    createdAtThreshold: Date;
  }) => Promise<{ id: string; key: string }[]>;

  updateFilesToStored: (params: {
    batchId: string;
    /**
     * Owner filter — same semantics as findFilesByBatchIdAndUploadedBy:
     * `undefined` matches only anonymous (ownerless) files, never any owner.
     */
    uploadedBy?: string;
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

export type StorageAdapter = {
  generatePresignedUpload: (params: {
    key: string;
    contentType: string;
    size: number;
    usageContext: string;
    entityId?: string;
    userId?: string;
    isPublic: boolean;
  }) => Promise<{ uploadUrl: string }>;

  uploadFile: (params: {
    key: string;
    contentType: string;
    size: number;
    usageContext: string;
    entityId?: string;
    userId?: string;
    isPublic: boolean;

    content: FileUploadContent;
  }) => Promise<{ key: string }>;

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

export type UploadStuffConfig<TFileUsageContext extends string> = {
  storageAdapter: StorageAdapter;
  databaseAdapter: DatabaseAdapter<TFileUsageContext>;
  fileIdGenerator: FileIdGenerator;
  fileKeyGenerator: FileKeyGenerator;
  filePublicUrlGenerator: FilePublicUrlGenerator;
};

export type CreateUploadStuffConfig<TFileUsageContext extends string> = SetOptional<
  UploadStuffConfig<TFileUsageContext>,
  "fileIdGenerator" | "fileKeyGenerator"
>;
