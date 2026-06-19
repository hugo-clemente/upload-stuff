import type { FieldsDeclaration } from "@upload-stuff/core";
import { UploadStuff } from "@upload-stuff/server";
import { s3Adapter } from "@upload-stuff/server/adapters/s3";
import { prismaAdapter } from "@upload-stuff/server/adapters/prisma";

import { prisma } from "./prisma";

// Local-only, non-secret MinIO defaults. Both the browser PUT and the server-side
// HEAD use this same localhost origin (Next runs on the host, not in Compose).
const MINIO_ENDPOINT = "http://localhost:9000";
const BUCKET = "uploads";

// Single source of truth for custom fields; `typeof fields` feeds the generics below.
const fields = { caption: { type: "string", required: false } } as const satisfies FieldsDeclaration;

export const uploadStuff = UploadStuff<"image">()({
  storageAdapter: s3Adapter({
    config: {
      region: "us-east-1",
      endpoint: MINIO_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: "minioadmin",
        secretAccessKey: "minioadmin",
      },
    },
    bucket: BUCKET,
  }),
  databaseAdapter: prismaAdapter<"image", typeof fields>({ prisma }),
  filePublicUrlGenerator: ({ key }) => `${MINIO_ENDPOINT}/${BUCKET}/${key}`,
  fields,
  // Typed against `fields`: file.scope is string|undefined, file.caption is string|undefined.
  objectMetadata: (file) => ({
    owner: file.scope ?? "",
    caption: file.caption ?? "",
  }),
});
