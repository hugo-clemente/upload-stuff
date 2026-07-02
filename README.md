# upload-stuff

A file-upload library built on presigned S3 uploads, a typed [Hono](https://hono.dev/) RPC layer, and React hooks. Define a typed file router on the server, wire it into your Next.js App Router (or any fetch-compatible runtime), and call `useUploadStuff` from the client.

## Packages

| Package                | Description                                                               |
| ---------------------- | ------------------------------------------------------------------------- |
| `@upload-stuff/server` | Server runtime (Hono), Next.js App Router handler, S3 and Prisma adapters |
| `@upload-stuff/client` | Framework-free upload engine (validation, presigned PUT, progress, abort) |
| `@upload-stuff/react`  | React hooks over the engine                                               |
| `@upload-stuff/core`   | Isomorphic types, Zod schemas, errors and utils (comes transitively)      |

All packages are ESM-only.

## Install

```sh
# Backend
pnpm add @upload-stuff/server

# Frontend
pnpm add @upload-stuff/client

# React bindings
pnpm add @upload-stuff/react

# @upload-stuff/core is a transitive dependency — no need to install it directly
```

```sh
# npm
npm install @upload-stuff/server
npm install @upload-stuff/client
npm install @upload-stuff/react
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

export const uploadStuff = UploadStuff<FileUsageContext>()({
  storageAdapter: s3Adapter({
    config: {
      region: "us-east-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    },
    bucket: process.env.S3_BUCKET!,
    // Optional — write object-storage metadata, typed against `fields` below by
    // inference. file.entityId and file.userId are typed from the declaration.
    objectMetadata: (file) => ({ entity: file.entityId ?? "", owner: file.userId ?? "" }),
  }),
  databaseAdapter: prismaAdapter({ prisma }),
  filePublicUrlGenerator: ({ key }) => `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${key}`,
  // Declare any custom columns persisted on every File row (typed end-to-end).
  fields: {
    entityId: { type: "string", required: false },
    userId: { type: "string", required: false },
  },
  // Optional — window (seconds) for presign expiry, the completion deadline, and
  // abandoned-row cleanup. Default 3600 (1h), range 1..604800.
  uploadWindowSeconds: 3600,
});
```

`UploadStuff<FileUsageContext>()` is curried: the type argument fixes the file-usage-context union, and the second call infers the `fields` declaration from the config.

The adapters are supplied as factories (`s3Adapter(...)`, `prismaAdapter(...)`): the library calls each with the instance's resolved types, so `TFileUsageContext` and `fields` are inferred end-to-end — you never pass adapter generics by hand, and an adapter's own typed options (like the S3 adapter's `objectMetadata`) are typed against your `fields` automatically.

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
    // Persist the uploader as a plain `userId` column (declared in `fields`) so
    // you can filter your own listing queries by it. It carries no auth weight —
    // completion is guarded by the secret batch token, not identity.
    .fields(({ ctx }) => ({ userId: ctx.userId }))
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
    // Persist the declared columns for this upload.
    .fields(({ input, ctx }) => ({ entityId: input.folderId, userId: ctx.userId }))
    .middleware(({ ctx, input }) => ({ userId: ctx.userId, folderId: input.folderId }))
    .onUploadComplete(({ files, middlewareData }) => ({
      folderId: middlewareData.folderId,
    }))
    .build(),
};

export type FileRouter = typeof fileRouter;
```

**Completion is guarded by a per-batch capability token, not identity.** Init returns a high-entropy secret `batchToken`; the server stores only `sha256(token)` and the client replays the token to finalize the batch. Holding the token is the authorization — treat it as a secret (HTTPS, request-body only, never logged). For owner-scoped *listing*, persist the uploader with `.fields()` (as above) and filter your own queries by that column; don't rely on it for completion auth. A leaked token lets its holder complete the batch and receive whatever your `onUploadComplete` returns, so keep sensitive values out of that return.

`.fields()` provides the values for the custom columns declared on `UploadStuff({ fields })`; add a matching column to your `File` table for each. The library itself ships no `userId`/`entityId` columns — declare what your app needs.

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

import { createUploadStuffClient } from "@upload-stuff/client";
import { createUploadStuffReactHelpers } from "@upload-stuff/react";
import type { FileRouter } from "@/lib/file-router";

const client = createUploadStuffClient<FileRouter>({
  baseURL: process.env.NEXT_PUBLIC_APP_URL!,
});

export const { useUploadStuff } = createUploadStuffReactHelpers<FileRouter>(client);
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

`createUploadStuffReactHelpers(client)` returns `{ useUploadStuff, useRouteConfig }`; create `client` once with `createUploadStuffClient<FileRouter>(...)` from `@upload-stuff/client`.

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
  // Optional. Typed against the instance's `fields` by inference.
  objectMetadata: (file) => ({ owner: file.userId ?? "" }),
});
```

`s3Adapter(...)` returns a factory that `UploadStuff(...)` calls with the instance's resolved types — pass it straight to `storageAdapter`. The `config` field accepts the full `S3ClientConfig` from `@aws-sdk/client-s3`.

Object-storage metadata is configured by `objectMetadata` on the **s3 adapter** (typed against your `fields`), and defaults to none. The adapter signs it as `x-amz-meta-*` request headers (kept out of the presigned URL) and the client replays them on the PUT. Object metadata is returned on every `GetObject`, so avoid putting sensitive values (e.g. a user id) in metadata on public buckets unless you intend to expose them.

### Peer dependencies

`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` (`>=3.700.0`) are **optional** peer dependencies — install them only if you use this adapter, so projects on another storage backend don't pull in the AWS SDK:

```sh
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

## Prisma adapter

Import from `@upload-stuff/server/adapters/prisma`.

```ts
import { prismaAdapter } from "@upload-stuff/server/adapters/prisma";

const db = prismaAdapter({ prisma });
```

**This is a reference adapter for one specific `File` schema** — it is not a general-purpose adapter. It implements the `DatabaseAdapter` interface from `@upload-stuff/core` against a particular Prisma model shape. `prismaAdapter({ prisma })` returns a factory; pass it straight to `databaseAdapter` and its types are inferred from your `UploadStuff(...)` config.

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
  // Plus one column per custom field declared on `UploadStuff({ fields })`.
  // e.g. for `fields: { entityId: {...}, userId: {...} }`:
  entityId          String?
  userId            String?
  createdAt         DateTime  @default(now())
}
```

### Custom database adapter

For any other ORM or database, implement the `DatabaseAdapter` interface from `@upload-stuff/core` and supply it as a factory (`DatabaseAdapterFactory`). The library calls the factory with a type-only marker, so you can let the types be inferred and ignore the argument:

```ts
import type { DatabaseAdapterFactory } from "@upload-stuff/core";

const myAdapter: DatabaseAdapterFactory<"avatar" | "document"> = () => ({
  createFiles: async ({ files }) => {
    /* ... */
  },
  findFilesByBatchId: async (params) => {
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
});

// ...then: databaseAdapter: myAdapter
```

## Server utilities

The `UploadStuff` instance exposes `serverUtils` for background tasks:

```ts
import { uploadStuff } from "@/lib/upload-stuff";

// Clean up never-completed upload sessions older than `uploadWindowSeconds` (default 1h)
await uploadStuff.serverUtils.cleanUpFiles();

// Upload a file directly from the server (no presigned URL flow)
await uploadStuff.serverUtils.uploadFile({
  data: {
    filename: "report.png",
    contentType: "image/png",
    size: buffer.byteLength,
    usageContext: "document",
    isPublic: false,
    // plus any columns declared in `fields`, e.g.:
    userId: "user-1",
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
| `.fields(fn)`           | Return values for the custom columns declared on `UploadStuff({ fields })`, persisted on the File row |
| `.onUploadComplete(fn)` | Called after the upload is verified; return value is sent back to the client               |
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
