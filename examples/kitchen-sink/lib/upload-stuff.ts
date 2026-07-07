import { UploadStuff } from "@upload-stuff/server";
import { s3Adapter } from "@upload-stuff/server/adapters/s3";
import { prismaAdapter } from "@upload-stuff/server/adapters/prisma";

import { prisma } from "./prisma";

// Local-only, non-secret MinIO defaults. Both the browser PUT and the server-side
// HEAD use this same localhost origin (Next runs on the host, not in Compose).
const MINIO_ENDPOINT = "http://localhost:9000";
const BUCKET = "uploads";

// Adapters are supplied as factories, so their types are inferred from this config —
// no explicit generics anywhere. `fields` is the single source of truth, and the
// s3 adapter's `objectMetadata` is typed against it by inference (file.userId /
// file.caption are typed with no annotation).
export const uploadStuff = UploadStuff({
  storageAdapter: s3Adapter({
    config: {
      region: "us-east-1",
      endpoint: MINIO_ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: "minioadmin", secretAccessKey: "minioadmin" },
    },
    bucket: BUCKET,
    objectMetadata: (file) => ({ owner: file.userId, caption: file.caption ?? "" }),
  }),
  databaseAdapter: prismaAdapter({ prisma }),
  filePublicUrlGenerator: ({ key }) => `${MINIO_ENDPOINT}/${BUCKET}/${key}`,
  uploadWindowSeconds: 3600,
  fields: {
    caption: { type: "string", required: false },
    userId: { type: "string", required: true },
  },
});
