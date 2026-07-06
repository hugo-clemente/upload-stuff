import type {
  AnyFileRoute,
  DatabaseAdapter,
  DatabaseFile,
  StorageAdapter,
} from "@upload-stuff/core";

/** In-memory database adapter for tests. */
export const fakeDatabaseAdapter = (opts: { createdAt?: Date } = {}): DatabaseAdapter => {
  let rows: DatabaseFile<string>[] = [];
  return {
    createFiles: async ({ files }) => {
      // `opts.createdAt` is a test override (wins over the core-stamped value) so
      // a test can simulate an old/expired batch; otherwise keep what the core set.
      rows.push(...files.map((f) => ({ ...f, createdAt: opts.createdAt ?? f.createdAt ?? new Date() })));
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
export const fakeStorageAdapter = (): StorageAdapter => ({
  generatePresignedUpload: async ({ key }) => ({
    uploadUrl: `https://upload.test/${key}`,
  }),
  uploadFile: async ({ key }) => ({ key }),
  verifyUpload: async () => ({ exists: true, isValid: true }),
  deleteFile: async () => {},
  batchDeleteFiles: async () => {},
});

/** Passthrough Standard Schema that accepts any input. */
export const passthroughParser: AnyFileRoute["inputParser"] = {
  "~standard": {
    validate: () => ({ value: {} }),
    version: 1,
    vendor: "test",
  },
};

export const makeRoute = (onComplete: () => unknown): AnyFileRoute => ({
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
