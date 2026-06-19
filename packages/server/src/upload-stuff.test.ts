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
        storageAdapter: () => fakeStorageAdapter(),
        databaseAdapter: () => fakeDatabaseAdapter(),
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
        storageAdapter: () => fakeStorageAdapter(),
        databaseAdapter: () => fakeDatabaseAdapter(),
        filePublicUrlGenerator: ({ key }) => key,
        fields: { entityId: { type: "string" } },
      }),
    ).not.toThrow();
  });
});

describe("serverUtils.uploadFile forwards row data to the storage adapter (#6)", () => {
  it("passes scope and the declared field values so the adapter can resolve object metadata", async () => {
    const uploads: Array<StorageObjectInfo> = [];
    const storageAdapter: StorageAdapter = {
      ...fakeStorageAdapter(),
      uploadFile: async (params) => {
        uploads.push(params);
        return { key: params.key };
      },
    };

    const uploadStuff = UploadStuff()({
      storageAdapter: () => storageAdapter,
      databaseAdapter: () => fakeDatabaseAdapter(),
      filePublicUrlGenerator: ({ key }) => `https://cdn.test/${key}`,
      fields: {
        entityId: { type: "string", required: false },
        count: { type: "number", required: true },
      },
    });

    await uploadStuff.serverUtils.uploadFile({
      data: {
        filename: "a.png",
        contentType: "image/png",
        size: 10,
        usageContext: "avatar",
        isPublic: false,
        scope: "owner-1",
        entityId: "e1",
        count: 5,
      },
      content: "data",
    });

    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.scope).toBe("owner-1");
    expect(uploads[0]!.filename).toBe("a.png");
    // Only the declared custom fields are forwarded (filtered to the declaration);
    // the storage adapter resolves its own object metadata from these.
    expect(uploads[0]!.fields).toEqual({ entityId: "e1", count: 5 });
  });
});
