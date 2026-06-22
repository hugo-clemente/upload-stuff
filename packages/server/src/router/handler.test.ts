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
const fakeDatabaseAdapter = (opts: { createdAt?: Date } = {}): DatabaseAdapter => {
  let rows: DatabaseFile<string>[] = [];
  return {
    createFiles: async ({ files }) => {
      rows.push(...files.map((f) => ({ ...f, createdAt: f.createdAt ?? opts.createdAt ?? new Date() })));
    },
    findFilesByBatchId: async ({ batchId }) => rows.filter((r) => r.batchId === batchId),
    findFilesToCleanUp: async () => [],
    updateFilesToStored: async ({ batchId }) => {
      let updatedCount = 0;
      rows = rows.map((r) => {
        if (r.batchId === batchId && !r.stored) {
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

    await handlers.completeUpload("avatars", { batchToken: init.batchToken }, ctx);
    expect(getCompletions().avatarsCompletions).toBe(1);
  });

  it("rejects completing a batch through a different endpoint", async () => {
    const { handlers, getCompletions } = setup();
    const init = await handlers.initUpload("avatars", initData, ctx);

    await expect(handlers.completeUpload("docs", { batchToken: init.batchToken }, ctx)).rejects.toThrow(
      UploadStuffError,
    );
    expect(getCompletions().docsCompletions).toBe(0);
  });

  it("is idempotent — onUploadComplete runs once per batch", async () => {
    const { handlers, getCompletions } = setup();
    const init = await handlers.initUpload("avatars", initData, ctx);

    await handlers.completeUpload("avatars", { batchToken: init.batchToken }, ctx);
    await handlers.completeUpload("avatars", { batchToken: init.batchToken }, ctx);

    expect(getCompletions().avatarsCompletions).toBe(1);
  });

  it("throws when no files exist for a batch", async () => {
    const { handlers } = setup();
    await expect(handlers.completeUpload("avatars", { batchToken: "missing" }, ctx)).rejects.toThrow(
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
    await handlers.completeUpload("avatars", { batchToken: init.batchToken }, ctx);
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
      stored: true,
      batchId: "attacker",
    }));

    await handlers.initUpload("avatars", initData, ctx);

    expect(created[0]!.stored).toBe(false);
    expect(created[0]!.batchId).not.toBe("attacker");
  });
});

describe("capability-based completion", () => {
  it("completes for any caller holding the batch handle", async () => {
    const { handlers } = setup();
    const init = await handlers.initUpload("avatars", initData, { userId: "A" });
    // A different principal who holds the handle can complete — the handle is
    // the guard, not identity.
    const res = await handlers.completeUpload("avatars", { batchToken: init.batchToken }, { userId: "B" });
    expect(res.files).toHaveLength(1);
  });

  it("rejects completion with an unknown handle", async () => {
    const { handlers } = setup();
    await handlers.initUpload("avatars", initData, { userId: "A" });
    await expect(
      handlers.completeUpload("avatars", { batchToken: "not-a-real-handle" }, { userId: "A" }),
    ).rejects.toThrow(UploadStuffError);
  });
});

describe("token hashing", () => {
  it("stores sha256(batchToken) as the row batchId, never the raw token", async () => {
    const created: DatabaseFile<string>[] = [];
    const databaseAdapter: DatabaseAdapter = {
      ...fakeDatabaseAdapter(),
      createFiles: async ({ files }) => {
        created.push(...files);
      },
      // make completion find the stored (hashed) rows
      findFilesByBatchId: async ({ batchId }) => created.filter((r) => r.batchId === batchId),
    };
    const uploadStuff = UploadStuff()({
      storageAdapter: () => fakeStorageAdapter(),
      databaseAdapter: () => databaseAdapter,
      filePublicUrlGenerator: ({ key }) => `https://cdn.test/${key}`,
    });
    const handlers = fileRouteHandlers({ fileRouter: { avatars: makeRoute(() => ({})) }, uploadStuff });

    const init = await handlers.initUpload("avatars", initData, ctx);
    const { createHash } = await import("node:crypto");
    const expectedHash = createHash("sha256").update(init.batchToken).digest("hex");

    expect(created[0]!.batchId).toBe(expectedHash);
    expect(created[0]!.batchId).not.toBe(init.batchToken);

    // completing with the raw token (which the handler hashes) succeeds
    const res = await handlers.completeUpload("avatars", { batchToken: init.batchToken }, ctx);
    expect(res.files).toHaveLength(1);
  });
});

describe("upload window", () => {
  const makeHandlers = (createdAt?: Date) => {
    const uploadStuff = UploadStuff()({
      storageAdapter: () => fakeStorageAdapter(),
      databaseAdapter: () => fakeDatabaseAdapter({ createdAt }),
      filePublicUrlGenerator: ({ key }) => `https://cdn.test/${key}`,
      uploadWindowSeconds: 3600,
    });
    return fileRouteHandlers({ fileRouter: { avatars: makeRoute(() => ({})) }, uploadStuff });
  };

  it("completes within the window", async () => {
    const handlers = makeHandlers(new Date());
    const init = await handlers.initUpload("avatars", initData, ctx);
    const res = await handlers.completeUpload("avatars", { batchToken: init.batchToken }, ctx);
    expect(res.files).toHaveLength(1);
  });

  it("rejects completion past the window", async () => {
    const handlers = makeHandlers(new Date(Date.now() - 7200_000)); // 2h ago, window 1h
    const init = await handlers.initUpload("avatars", initData, ctx);
    await expect(
      handlers.completeUpload("avatars", { batchToken: init.batchToken }, ctx),
    ).rejects.toThrow(/window expired/i);
  });

  it("returns idempotent success for an already-completed batch even past the window", async () => {
    const { createHash } = await import("node:crypto");
    const batchToken = "already-done-token";
    const batchId = createHash("sha256").update(batchToken).digest("hex");

    // A batch finalised long ago: rows stored=true, createdAt well past a 1s window.
    const storedRow: DatabaseFile<string> = {
      id: "f1",
      key: "k1",
      filename: "a.png",
      size: 1024,
      publicUrl: "https://cdn.test/k1",
      contentType: "image/png",
      usageContext: "avatars",
      isPublic: false,
      stored: true,
      storedAt: new Date(Date.now() - 5000),
      batchId,
      createdAt: new Date(Date.now() - 5000),
      uploadSessionData: { input: null, middlewareData: {}, endpoint: "avatars" },
    };

    let completions = 0;
    const databaseAdapter: DatabaseAdapter = {
      ...fakeDatabaseAdapter(),
      findFilesByBatchId: async ({ batchId: id }) => (id === batchId ? [storedRow] : []),
      updateFilesToStored: async () => ({ updatedCount: 0 }),
    };
    const uploadStuff = UploadStuff()({
      storageAdapter: () => fakeStorageAdapter(),
      databaseAdapter: () => databaseAdapter,
      filePublicUrlGenerator: ({ key }) => `https://cdn.test/${key}`,
      uploadWindowSeconds: 1, // 1s window; the row is 5s old → window is expired
    });
    const handlers = fileRouteHandlers({
      fileRouter: { avatars: makeRoute(() => { completions++; return {}; }) },
      uploadStuff,
    });

    // Past the window, but already stored → the short-circuit returns success
    // BEFORE the window check, so it must not throw "Upload window expired" and
    // must not re-run onUploadComplete. If the ordering were reversed, the
    // expired-window check would throw here.
    const res = await handlers.completeUpload("avatars", { batchToken }, ctx);
    expect(res.files).toHaveLength(1);
    expect(completions).toBe(0);
  });
});
