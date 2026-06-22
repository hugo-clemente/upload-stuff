import { describe, expect, it } from "vite-plus/test";

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
    findFilesByBatchIdAndScope: async ({ batchId, scope }) =>
      // `undefined` matches only scopeless (anonymous) files — never any scope.
      rows.filter((r) => r.batchId === batchId && r.scope === scope),
    findFilesToCleanUp: async () => [],
    updateFilesToStored: async ({ batchId, scope }) => {
      let updatedCount = 0;
      rows = rows.map((r) => {
        if (r.batchId === batchId && r.scope === scope && !r.stored) {
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

const makeRoute = (
  onComplete: () => unknown,
  scope: AnyFileRoute["scope"] = () => undefined,
): AnyFileRoute => ({
  $types: {} as AnyFileRoute["$types"],
  routeConfig: {
    isPublic: false,
    type: "image",
    usageContext: "avatars",
    maxFileSize: "5MB",
  },
  inputParser: passthroughParser,
  scope,
  middleware: () => ({}),
  fields: () => ({}),
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
  const uploadStuff = UploadStuff()({
    storageAdapter: () => fakeStorageAdapter(),
    databaseAdapter: () => fakeDatabaseAdapter(),
    filePublicUrlGenerator: ({ key }) => `https://cdn.test/${key}`,
  });
  const handlers = fileRouteHandlers({ fileRouter, uploadStuff });
  return {
    handlers,
    getCompletions: () => ({ avatarsCompletions, docsCompletions }),
  };
};

/** Handlers for a single `avatars` route scoped by the given resolver. */
const setupScoped = (scope: AnyFileRoute["scope"]) => {
  const fileRouter = {
    avatars: makeRoute(() => ({ route: "avatars" }), scope),
  };
  const uploadStuff = UploadStuff()({
    storageAdapter: () => fakeStorageAdapter(),
    databaseAdapter: () => fakeDatabaseAdapter(),
    filePublicUrlGenerator: ({ key }) => `https://cdn.test/${key}`,
  });
  return fileRouteHandlers({ fileRouter, uploadStuff });
};

const ctx = { userId: "user-1" };
const initData = {
  files: [{ filename: "a.png", contentType: "image/png", size: 1024 }],
  input: null,
};

describe("fileRouteHandlers", () => {
  it("rejects an unknown endpoint", async () => {
    const { handlers } = setup();
    await expect(handlers.initUpload("nope", initData, ctx)).rejects.toThrow(UploadStuffError);
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

    await expect(handlers.completeUpload("docs", { batchId: init.batchId }, ctx)).rejects.toThrow(
      UploadStuffError,
    );
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
    await expect(handlers.completeUpload("avatars", { batchId: "missing" }, ctx)).rejects.toThrow(
      UploadStuffError,
    );
  });

  it("does not pass live ctx to onUploadComplete", async () => {
    let receivedKeys: string[] = [];
    const route: AnyFileRoute = {
      ...makeRoute(() => ({})),
      onUploadComplete: (args) => {
        receivedKeys = Object.keys(args);
        return {};
      },
    };
    const uploadStuff = UploadStuff()({
      storageAdapter: () => fakeStorageAdapter(),
      databaseAdapter: () => fakeDatabaseAdapter(),
      filePublicUrlGenerator: ({ key }) => `https://cdn.test/${key}`,
    });
    const handlers = fileRouteHandlers({ fileRouter: { avatars: route }, uploadStuff });
    const init = await handlers.initUpload("avatars", initData, ctx);
    await handlers.completeUpload("avatars", { batchId: init.batchId }, ctx);
    expect(receivedKeys).not.toContain("ctx");
    expect(receivedKeys.sort()).toEqual(["files", "input", "middlewareData"]);
  });
});

describe("presigned upload headers (#5)", () => {
  it("surfaces the storage adapter's requiredHeaders on each plan file", async () => {
    const storageAdapter: StorageAdapter = {
      ...fakeStorageAdapter(),
      generatePresignedUpload: async ({ key }) => ({
        uploadUrl: `https://upload.test/${key}`,
        requiredHeaders: { "x-amz-meta-owner": "alice" },
      }),
    };
    const uploadStuff = UploadStuff()({
      storageAdapter: () => storageAdapter,
      databaseAdapter: () => fakeDatabaseAdapter(),
      filePublicUrlGenerator: ({ key }) => `https://cdn.test/${key}`,
    });
    const handlers = fileRouteHandlers({
      fileRouter: { avatars: makeRoute(() => ({})) },
      uploadStuff,
    });

    const init = await handlers.initUpload("avatars", initData, ctx);
    expect(init.files[0]!.uploadHeaders).toEqual({ "x-amz-meta-owner": "alice" });
  });
});

describe("custom field persistence (#8 / #1)", () => {
  /** Captures the rows handed to `createFiles`. */
  const capturingSetup = (fields: () => Record<string, unknown>) => {
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    const created: DatabaseFile<string, any>[] = [];
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    const databaseAdapter: DatabaseAdapter<string, any> = {
      ...fakeDatabaseAdapter(),
      createFiles: async ({ files }) => {
        created.push(...files);
      },
    };
    const uploadStuff = UploadStuff()({
      storageAdapter: () => fakeStorageAdapter(),
      databaseAdapter: () => databaseAdapter,
      filePublicUrlGenerator: ({ key }) => `https://cdn.test/${key}`,
      fields: {
        entityId: { type: "string", required: false },
        count: { type: "number", required: true },
      },
    });
    const route: AnyFileRoute = { ...makeRoute(() => ({})), fields };
    const handlers = fileRouteHandlers({ fileRouter: { avatars: route }, uploadStuff });
    return { handlers, created };
  };

  it("persists only declared field keys, dropping stray keys", async () => {
    const { handlers, created } = capturingSetup(() => ({
      entityId: "e1",
      count: 3,
      // a typo / undeclared key must never reach the row
      typo: "nope",
    }));

    await handlers.initUpload("avatars", initData, ctx);

    expect(created[0]).toMatchObject({ entityId: "e1", count: 3 });
    expect(created[0]).not.toHaveProperty("typo");
  });

  it("cannot overwrite a library-owned column via a field value", async () => {
    const { handlers, created } = capturingSetup(() => ({
      entityId: "e1",
      count: 3,
      // even if a resolver returns a reserved key, it must not clobber state
      scope: "attacker",
      stored: true,
    }));

    await handlers.initUpload("avatars", initData, ctx);

    expect(created[0]!.scope).toBeUndefined();
    expect(created[0]!.stored).toBe(false);
  });
});

describe("scope ownership guard", () => {
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  const byUser: AnyFileRoute["scope"] = ({ ctx }) => (ctx as any).userId;

  it("completes when the same scope is re-derived (AE1)", async () => {
    const handlers = setupScoped(byUser);
    const init = await handlers.initUpload("avatars", initData, { userId: "A" });

    const res = await handlers.completeUpload("avatars", { batchId: init.batchId }, { userId: "A" });
    expect(res.files).toHaveLength(1);
  });

  it("rejects completion when a different scope is re-derived (AE2)", async () => {
    const handlers = setupScoped(byUser);
    const init = await handlers.initUpload("avatars", initData, { userId: "A" });

    await expect(
      handlers.completeUpload("avatars", { batchId: init.batchId }, { userId: "B" }),
    ).rejects.toThrow(UploadStuffError);
  });

  it("completes an anonymous batch for any caller (AE3)", async () => {
    const handlers = setupScoped(() => undefined);
    const init = await handlers.initUpload("avatars", initData, {});

    const res = await handlers.completeUpload("avatars", { batchId: init.batchId }, {});
    expect(res.files).toHaveLength(1);
  });
});
