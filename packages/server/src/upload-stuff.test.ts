import { describe, expect, it } from "vite-plus/test";

import type { DatabaseAdapter, DatabaseFile, StorageAdapter, StorageObjectInfo } from "@upload-stuff/core";

import { UploadStuff } from "./upload-stuff";

/* oxlint-disable @typescript-eslint/no-explicit-any */

const fakeStorageAdapter = (): StorageAdapter => ({
  generatePresignedUpload: async ({ key }) => ({ uploadUrl: `https://upload.test/${key}` }),
  uploadFile: async ({ key }) => ({ key }),
  verifyUpload: async () => ({ exists: true, isValid: true }),
  deleteFile: async () => {},
  batchDeleteFiles: async () => {},
});

const fakeDatabaseAdapter = (): DatabaseAdapter<string, any> => ({
  createFiles: async () => {},
  findFilesByBatchIdAndScope: async () => [],
  findFilesToCleanUp: async () => [],
  updateFilesToStored: async () => ({ updatedCount: 0 }),
  updateFile: async ({ file }) => file as DatabaseFile<string, any>,
  deleteFiles: async () => {},
});

describe("UploadStuff reserved field names (#1)", () => {
  it("throws when a custom field reuses a reserved column name", () => {
    expect(() =>
      UploadStuff()({
        storageAdapter: fakeStorageAdapter(),
        databaseAdapter: fakeDatabaseAdapter(),
        filePublicUrlGenerator: ({ key }) => key,
        // `as any` bypasses the type-level guard to exercise the runtime guard,
        // standing in for a plain-JS caller.
        fields: { scope: { type: "string" } } as any,
      }),
    ).toThrow(/reserved/);
  });

  it("accepts non-reserved custom field names", () => {
    expect(() =>
      UploadStuff()({
        storageAdapter: fakeStorageAdapter(),
        databaseAdapter: fakeDatabaseAdapter(),
        filePublicUrlGenerator: ({ key }) => key,
        fields: { entityId: { type: "string" } },
      }),
    ).not.toThrow();
  });
});

describe("serverUtils.uploadFile objectMetadata (#6)", () => {
  it("resolves objectMetadata and forwards it to the storage adapter", async () => {
    const uploads: Array<StorageObjectInfo> = [];
    const storageAdapter: StorageAdapter = {
      ...fakeStorageAdapter(),
      uploadFile: async (params) => {
        uploads.push(params);
        return { key: params.key };
      },
    };

    const uploadStuff = UploadStuff()({
      storageAdapter,
      databaseAdapter: fakeDatabaseAdapter(),
      filePublicUrlGenerator: ({ key }) => `https://cdn.test/${key}`,
      fields: {
        entityId: { type: "string", required: false },
        count: { type: "number", required: true },
      },
      objectMetadata: (file) => ({ owner: file.entityId ?? "", n: String(file.count) }),
    });

    await uploadStuff.serverUtils.uploadFile({
      data: {
        filename: "a.png",
        contentType: "image/png",
        size: 10,
        usageContext: "avatar",
        isPublic: false,
        entityId: "e1",
        count: 5,
      },
      content: "data",
    });

    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.objectMetadata).toEqual({ owner: "e1", n: "5" });
  });
});
