import { describe, expect, it } from "vitest";

import { UploadStuffError } from "@upload-stuff/core";
import type {
  AnyFileRoute,
  DatabaseAdapter,
  DatabaseFile,
  StorageAdapter,
} from "@upload-stuff/core";

import { UploadStuff } from "../upload-stuff";
import { fileRouteHandlers } from "./handler";

/** In-memory database adapter for tests. */
const fakeDatabaseAdapter = (): DatabaseAdapter => {
  let rows: DatabaseFile<string>[] = [];
  return {
    createFiles: async ({ files }) => {
      rows.push(...files);
    },
    findFilesByBatchIdAndUploadedBy: async ({ batchId, uploadedBy }) =>
      // `undefined` matches only ownerless files — never any owner.
      rows.filter(
        (r) => r.batchId === batchId && r.uploadedBy === uploadedBy,
      ),
    findFilesToCleanUp: async () => [],
    updateFilesToStored: async ({ batchId, uploadedBy }) => {
      let updatedCount = 0;
      rows = rows.map((r) => {
        if (
          r.batchId === batchId &&
          r.uploadedBy === uploadedBy &&
          !r.stored
        ) {
          updatedCount++;
          return { ...r, stored: true };
        }
        return r;
      });
      return { updatedCount };
    },
    updateFile: async ({ file }) => {
      rows = rows.map((r) => (r.id === file.id ? { ...r, ...file } : r));
      return rows.find((r) => r.id === file.id)!;
    },
    deleteFiles: async () => {},
  };
};

/** Storage adapter that always reports a valid upload. */
const fakeStorageAdapter = (): StorageAdapter => ({
  generatePresignedUpload: async ({ key }) => ({
    uploadUrl: `https://upload.test/${key}`,
  }),
  uploadFile: async ({ key }) => ({ key }),
  verifyUpload: async () => ({ exists: true, isValid: true }),
  deleteFile: async () => {},
  batchDeleteFiles: async () => {},
});

/** Passthrough Standard Schema that accepts any input. */
const passthroughParser: AnyFileRoute["inputParser"] = {
  "~standard": {
    validate: () => ({ value: {} }),
    version: 1,
    vendor: "test",
  },
};

const makeRoute = (onComplete: () => unknown): AnyFileRoute => ({
  $types: {} as AnyFileRoute["$types"],
  routeConfig: {
    isPublic: false,
    type: "image",
    usageContext: "avatars",
    maxFileSize: "5MB",
  },
  inputParser: passthroughParser,
  middleware: () => ({}),
  metadata: () => ({}),
  onUploadComplete: onComplete,
});

const setup = () => {
  let avatarsCompletions = 0;
  let docsCompletions = 0;
  const fileRouter = {
    avatars: makeRoute(() => {
      avatarsCompletions++;
      return { route: "avatars" };
    }),
    docs: makeRoute(() => {
      docsCompletions++;
      return { route: "docs" };
    }),
  };
  const uploadStuff = UploadStuff({
    storageAdapter: fakeStorageAdapter(),
    databaseAdapter: fakeDatabaseAdapter(),
    filePublicUrlGenerator: ({ key }) => `https://cdn.test/${key}`,
  });
  const handlers = fileRouteHandlers({ fileRouter, uploadStuff });
  return {
    handlers,
    getCompletions: () => ({ avatarsCompletions, docsCompletions }),
  };
};

const ctx = { userId: "user-1" };
const initData = {
  files: [{ filename: "a.png", contentType: "image/png", size: 1024 }],
  input: null,
};

describe("fileRouteHandlers", () => {
  it("rejects an unknown endpoint", async () => {
    const { handlers } = setup();
    await expect(handlers.initUpload("nope", initData, ctx)).rejects.toThrow(
      UploadStuffError,
    );
  });

  it("runs init then complete on the same endpoint", async () => {
    const { handlers, getCompletions } = setup();
    const init = await handlers.initUpload("avatars", initData, ctx);
    expect(init.files).toHaveLength(1);

    await handlers.completeUpload("avatars", { batchId: init.batchId }, ctx);
    expect(getCompletions().avatarsCompletions).toBe(1);
  });

  it("rejects completing a batch through a different endpoint", async () => {
    const { handlers, getCompletions } = setup();
    const init = await handlers.initUpload("avatars", initData, ctx);

    await expect(
      handlers.completeUpload("docs", { batchId: init.batchId }, ctx),
    ).rejects.toThrow(UploadStuffError);
    expect(getCompletions().docsCompletions).toBe(0);
  });

  it("is idempotent — onUploadComplete runs once per batch", async () => {
    const { handlers, getCompletions } = setup();
    const init = await handlers.initUpload("avatars", initData, ctx);

    await handlers.completeUpload("avatars", { batchId: init.batchId }, ctx);
    await handlers.completeUpload("avatars", { batchId: init.batchId }, ctx);

    expect(getCompletions().avatarsCompletions).toBe(1);
  });

  it("throws when no files exist for a batch", async () => {
    const { handlers } = setup();
    await expect(
      handlers.completeUpload("avatars", { batchId: "missing" }, ctx),
    ).rejects.toThrow(UploadStuffError);
  });
});
