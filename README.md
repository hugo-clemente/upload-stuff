# upload-stuff

A file-upload library built on presigned S3 uploads, a typed [Hono](https://hono.dev/) RPC layer, and React hooks. Define a typed file router on the server, wire it into your Next.js App Router (or any fetch-compatible runtime), and call `useUploadStuff` from the client.

## Packages

| Package                | Description                                                               |
| ---------------------- | ------------------------------------------------------------------------- |
| `@upload-stuff/server` | Server runtime (Hono), Next.js App Router handler, S3 and Prisma adapters |
| `@upload-stuff/client` | React hooks and helpers                                                   |
| `@upload-stuff/core`   | Isomorphic types, Zod schemas, errors and utils (comes transitively)      |

All packages are ESM-only.

## Install

```sh
# Backend
pnpm add @upload-stuff/server

# Frontend
pnpm add @upload-stuff/client

# @upload-stuff/core is a transitive dependency — no need to install it directly
```

```sh
# npm
npm install @upload-stuff/server
npm install @upload-stuff/client
```

## Server usage

### 1. Create an `UploadStuff` instance

```ts
// lib/upload-stuff.ts
import { UploadStuff } from "@upload-stuff/server";
import { s3Adapter } from "@upload-stuff/server/adapters/s3";
import { prismaAdapter } from "@upload-stuff/server/adapters/prisma";
import { prisma } from "./prisma"; // your PrismaClient instance

type FileUsageContext = "avatar" | "document";

export const uploadStuff = UploadStuff<FileUsageContext>({
  storageAdapter: s3Adapter({
    config: {
      region: "us-east-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    },
    bucket: process.env.S3_BUCKET!,
  }),
  databaseAdapter: prismaAdapter({ prisma }),
  filePublicUrlGenerator: ({ key }) => `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${key}`,
});
```

### 2. Define a file router

```ts
// lib/file-router.ts
import { z } from "zod";
import { createUploadStuffRouter } from "@upload-stuff/server";
import { uploadStuff } from "./upload-stuff";

type Context = { userId: string };

const f = createUploadStuffRouter<Context, typeof uploadStuff>();

export const fileRouter = {
  avatar: f({
    isPublic: true,
    type: "image",
    usageContext: "avatar",
    maxFileSize: "4MB",
    maxFileCount: 1,
  })
    .middleware(({ ctx }) => ({ userId: ctx.userId }))
    .onUploadComplete(({ files, middlewareData }) => {
      console.log("Uploaded by", middlewareData.userId, files);
    })
    .build(),

  document: f({
    isPublic: false,
    type: "image",
    usageContext: "document",
    maxFileSize: "16MB",
  })
    .input(z.object({ folderId: z.string() }))
    .middleware(({ ctx, input }) => ({ userId: ctx.userId, folderId: input.folderId }))
    .onUploadComplete(({ files, middlewareData }) => ({
      folderId: middlewareData.folderId,
    }))
    .build(),
};

export type FileRouter = typeof fileRouter;
```

### 3. Wire up the Next.js App Router handler

Create `app/api/upload-stuff/[...uploadStuff]/route.ts`:

```ts
import { toNextJsHandler } from "@upload-stuff/server/next";
import { uploadStuff } from "@/lib/upload-stuff";
import { fileRouter } from "@/lib/file-router";
import { auth } from "@/lib/auth"; // your auth helper

export const { GET, POST } = toNextJsHandler({
  uploadStuff,
  fileRouter,
  config: {},
  createContext: async ({ headers }) => {
    const session = await auth(headers);
    return { userId: session.userId };
  },
});
```

`toNextJsHandler` returns `{ GET, POST }` route handlers backed by `app.fetch` from Hono. It has no dependency on the `next` npm package.

## Client usage

### Create typed helpers

```ts
// lib/upload-stuff-client.ts
"use client";

import { createUploadStuffReactHelpers } from "@upload-stuff/client";
import type { FileRouter } from "@/lib/file-router";

export const { useUploadStuff } = createUploadStuffReactHelpers<FileRouter>({
  baseURL: process.env.NEXT_PUBLIC_APP_URL!,
  // basePath defaults to "/api/upload-stuff"
});
```

### Use in a component

```tsx
"use client";

import { useUploadStuff } from "@/lib/upload-stuff-client";

export function AvatarUpload() {
  const { startUpload, isUploading, accept, isLoading } = useUploadStuff((r) => r.avatar, {
    onClientUploadComplete: (res) => {
      console.log("Done:", res.files);
    },
    onUploadError: (err) => {
      console.error(err.message);
    },
    onUploadProgress: (percent) => {
      console.log(`${percent}%`);
    },
  });

  return (
    <input
      type="file"
      accept={accept}
      disabled={isUploading || isLoading}
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        startUpload(files);
      }}
    />
  );
}
```

`createUploadStuffReactHelpers` returns `{ useUploadStuff, useRouteConfig }`.

`useUploadStuff` returns `{ startUpload, isUploading, isLoading, routeConfig, accept }`.

## S3 adapter

Import from `@upload-stuff/server/adapters/s3`.

```ts
import { s3Adapter } from "@upload-stuff/server/adapters/s3";

const storage = s3Adapter({
  config: {
    // Any AWS.S3ClientConfig options, e.g.:
    region: "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  },
  bucket: "my-bucket",
});
```

The `config` field accepts the full `S3ClientConfig` from `@aws-sdk/client-s3`.

## Prisma adapter

Import from `@upload-stuff/server/adapters/prisma`.

```ts
import { prismaAdapter } from "@upload-stuff/server/adapters/prisma";

const db = prismaAdapter({ prisma });
```

**This is a reference adapter for one specific `File` schema** — it is not a general-purpose adapter. It implements the `DatabaseAdapter` interface from `@upload-stuff/core` against a particular Prisma model shape.

### Peer dependency

`@prisma/client >=5.16` is required (for `updateManyAndReturn`) and is an **optional** peer dependency:

```sh
pnpm add @prisma/client
```

### Required `File` model

Your Prisma schema must define a `File` model with at least these columns:

```prisma
model File {
  id                String    @id
  key               String    @unique
  filename          String
  size              Int
  publicUrl         String
  contentType       String
  uploadSessionData Json?
  usageContext      String
  isPublic          Boolean   @default(false)
  stored            Boolean   @default(false)
  storedAt          DateTime?
  batchId           String?
  uploadedBy        String?
  entityId          String?
  createdAt         DateTime  @default(now())
}
```

### Custom database adapter

For any other ORM or database, implement the `DatabaseAdapter` interface from `@upload-stuff/core`:

```ts
import type { DatabaseAdapter } from "@upload-stuff/core";

const myAdapter: DatabaseAdapter<"avatar" | "document"> = {
  createFile: async ({ file }) => {
    /* ... */
  },
  findFilesByBatchIdAndUploadedBy: async (params) => {
    /* ... */
  },
  findFilesToCleanUp: async (params) => {
    /* ... */
  },
  updateFilesToStored: async (params) => {
    /* ... */
  },
  updateFile: async ({ file }) => {
    /* ... */
  },
  deleteFiles: async (params) => {
    /* ... */
  },
};
```

## Server utilities

The `UploadStuff` instance exposes `serverUtils` for background tasks:

```ts
import { uploadStuff } from "@/lib/upload-stuff";

// Clean up upload sessions older than 24 hours that were never completed
await uploadStuff.serverUtils.cleanUpFiles();

// Upload a file directly from the server (no presigned URL flow)
await uploadStuff.serverUtils.uploadFile({
  data: {
    filename: "report.png",
    contentType: "image/png",
    size: buffer.byteLength,
    usageContext: "document",
    isPublic: false,
    uploadedBy: userId,
  },
  content: buffer,
});

// Delete files by ID
await uploadStuff.serverUtils.deleteFiles([fileId]);
```

## Route builder API

`createUploadStuffRouter<TContext, TUploadStuff>()` returns a function that accepts a `RouteConfig` and returns an `UploadBuilder`. The builder methods are chainable:

| Method                  | Description                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `.input(schema)`        | Attach a [Standard Schema](https://standardschema.dev/)-compatible input parser (e.g. Zod) |
| `.middleware(fn)`       | Run server-side logic; return data forwarded to `onUploadComplete`                         |
| `.metadata(fn)`         | Attach `entityId` metadata                                                                 |
| `.onUploadComplete(fn)` | Called after S3 upload is verified; return value is sent back to the client                |
| `.build()`              | Finalise and return the `FileRoute`                                                        |

`RouteConfig` fields:

| Field          | Type                                                                | Description                                |
| -------------- | ------------------------------------------------------------------- | ------------------------------------------ |
| `usageContext` | `TFileUsageContext`                                                 | Discriminator stored in the database       |
| `type`         | `AcceptedFileType \| AcceptedFileType[]` (currently only `"image"`) | Accepted file category                     |
| `maxFileSize`  | `FileSize` (e.g. `"4MB"`)                                           | Maximum file size per file                 |
| `maxFileCount` | `number` (optional)                                                 | Maximum number of files per batch          |
| `isPublic`     | `boolean`                                                           | Whether the S3 object ACL is `public-read` |

## License

MIT
