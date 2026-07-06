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
  findFilesByBatchId: async () => [],
  findFilesToCleanUp: async () => [],
  updateFilesToStored: async () => ({ updatedCount: 0 }),
  updateFile: async ({ file }) => file as DatabaseFile<string, any>,
  deleteFiles: async () => {},
});

const baseConfig = {
  storageAdapter: () => fakeStorageAdapter(),
  databaseAdapter: () => fakeDatabaseAdapter(),
  filePublicUrlGenerator: ({ key }: { key: string }) => key,
};

describe("UploadStuff reserved field names (#1)", () => {
  it("throws when a custom field reuses a reserved column name", () => {
    expect(() =>
      UploadStuff()({
        ...baseConfig,
        // `as any` bypasses the type-level guard to exercise the runtime guard,
        // standing in for a plain-JS caller.
        fields: { stored: { type: "string" } } as any,
      }),
    ).toThrow(/reserved/);
  });

  it("accepts non-reserved custom field names", () => {
    expect(() =>
      UploadStuff()({
        ...baseConfig,
        fields: { entityId: { type: "string" } },
      }),
    ).not.toThrow();
  });
});

describe("uploadWindowSeconds validation", () => {
  it("accepts the boundaries 1 and 604800 and the default", () => {
    expect(() => UploadStuff()({ ...baseConfig })).not.toThrow();
    expect(() => UploadStuff()({ ...baseConfig, uploadWindowSeconds: 1 })).not.toThrow();
    expect(() => UploadStuff()({ ...baseConfig, uploadWindowSeconds: 604800 })).not.toThrow();
  });
  it("rejects 0, negative, non-integer, NaN, and >604800", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, 604801]) {
      expect(() => UploadStuff()({ ...baseConfig, uploadWindowSeconds: bad })).toThrow(
        /uploadWindowSeconds/,
      );
    }
  });
});

describe("defaultMaxFileCount / defaultMaxFileSize validation", () => {
  it("defaults to 20 and 4MB", () => {
    const instance = UploadStuff()(baseConfig);
    expect(instance.__defaultMaxFileCount).toBe(20);
    expect(instance.__defaultMaxFileSize).toBe("4MB");
  });

  it("accepts explicit values", () => {
    const instance = UploadStuff()({
      ...baseConfig,
      defaultMaxFileCount: 5,
      defaultMaxFileSize: "1MB",
    });
    expect(instance.__defaultMaxFileCount).toBe(5);
    expect(instance.__defaultMaxFileSize).toBe("1MB");
  });

  it("rejects invalid values", () => {
    expect(() => UploadStuff()({ ...baseConfig, defaultMaxFileCount: -1 })).toThrow(
      /defaultMaxFileCount/,
    );
    expect(() => UploadStuff()({ ...baseConfig, defaultMaxFileCount: 1.5 })).toThrow(
      /defaultMaxFileCount/,
    );
    expect(() => UploadStuff()({ ...baseConfig, defaultMaxFileSize: "0B" })).toThrow(
      /defaultMaxFileSize/,
    );
  });
});

describe("serverUtils.cleanUpFiles threshold", () => {
  it("uses uploadWindowSeconds as the createdAt threshold", async () => {
    let threshold: Date | undefined;
    const databaseAdapter: DatabaseAdapter<string, any> = {
      ...fakeDatabaseAdapter(),
      findFilesToCleanUp: async (p) => {
        threshold = p.createdAtThreshold;
        return [];
      },
    };
    const uploadStuff = UploadStuff()({
      ...baseConfig,
      storageAdapter: () => fakeStorageAdapter(),
      databaseAdapter: () => databaseAdapter,
      uploadWindowSeconds: 100,
    });
    const expected = Date.now() - 100 * 1000;
    await uploadStuff.serverUtils.cleanUpFiles();
    expect(threshold).toBeInstanceOf(Date);
    expect(Math.abs(threshold!.getTime() - expected)).toBeLessThan(5000);
  });
});

describe("serverUtils.uploadFile forwards row data to the storage adapter (#6)", () => {
  it("passes the declared field values so the adapter can resolve object metadata", async () => {
    const uploads: Array<StorageObjectInfo> = [];
    const storageAdapter: StorageAdapter = {
      ...fakeStorageAdapter(),
      uploadFile: async (params) => {
        uploads.push(params);
        return { key: params.key };
      },
    };

    const uploadStuff = UploadStuff()({
      ...baseConfig,
      storageAdapter: () => storageAdapter,
      filePublicUrlGenerator: ({ key }: { key: string }) => `https://cdn.test/${key}`,
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
        entityId: "e1",
        count: 5,
      },
      content: "data",
    });

    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.filename).toBe("a.png");
    // Only the declared custom fields are forwarded (filtered to the declaration);
    // the storage adapter resolves its own object metadata from these.
    expect(uploads[0]!.fields).toEqual({ entityId: "e1", count: 5 });
  });
});
