# Kitchen-sink fullstack example Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `examples/kitchen-sink`, a Next.js App Router app that exercises the full `upload-stuff` public API end to end against a local MinIO + Postgres, with a per-user scoped gallery and a raw-fetch hijack demo of the `.scope()` ownership guard.

**Architecture:** The app uses the **shipped** `s3Adapter` (pointed at MinIO) and `prismaAdapter` (pointed at Postgres), both stood up by one `docker-compose.yml`. A single curried `UploadStuff<"image">()` instance declares a custom `caption` field and a typed `objectMetadata` resolver. One file route exercises `.input/.scope/.fields/.middleware/.onUploadComplete`. The Next handler's `createContext` reads an `x-user-id` request header; the React hook is taught (one-line library change) to forward its already-declared `headers` option so the client can send that header.

**Tech Stack:** Next.js 16 (App Router) + React 19, Postgres 16 + MinIO via Docker Compose, Prisma, Zod 4, the three `@upload-stuff/*` workspace packages.

**Test strategy (read first):** This is a demo / integration surface, and the repo has **no client-side unit-test harness**. The plan is therefore **verification-driven**, not unit-TDD: each task ends with a concrete check — `check-types`, `next build`, a `curl` against a live endpoint, or a real-browser end-to-end pass driven by Claude-in-Chrome. The hijack panel (Task 6) is itself the functional proof that header-forwarding and the scope guard work. The one change under `packages/` (Task 1) is verified by `check-types` + the downstream e2e, because wiring a React-hook+`hc` unit test harness for a single forwarding line is disproportionate.

## Global Constraints

- ESM-only monorepo; every package has `"type": "module"`. Copy this verbatim into the example's `package.json`.
- Node/TS settings inherit the repo style: `module`/`moduleResolution` = `ESNext`/`Bundler`, `strict: true`. The example mirrors `apps/docs/tsconfig.json` (Next plugin, `@/*` path).
- Pin dependency versions to those already in the lockfile: `next` `16.2.9`, `react`/`react-dom` `^19.2.7`, `zod` `4.1.11`, `typescript` `5.9.3`, `@types/node` `^25.9.2`, `@types/react` `^19.2.17`, `@types/react-dom` `^19.2.3`, `oxlint` `^1.69.0`.
- Workspace packages are consumed as `workspace:*` and listed in `next.config.mjs` `transpilePackages`.
- The only file modified under `packages/` is `packages/client/src/impl.ts` (Task 1). Do not touch core, server, or the adapters.
- No real auth, no real secrets: identity is the `x-user-id` header value; MinIO/Postgres creds are local-only throwaways (`minioadmin`/`minioadmin`, `postgres`/`postgres`).
- Example package name: `@upload-stuff/example-kitchen-sink` (private). Directory: `examples/kitchen-sink`.
- Commit messages end with the trailer `Claude-Session: https://claude.ai/code/session_01Jd2koGXFqNumUEnyw9sn6j`. Work stays on the current `example` branch (not `main`).

---

### Task 1: Forward the `headers` option in `useUploadStuff` (`@upload-stuff/client`)

The hook's `headers` option exists in the types (`packages/client/src/impl.ts:294,318`) but is never sent. Wire the merged headers (hook-level option + per-`startUpload` override) into the `init-upload` and `complete-upload` calls. (The `route-config` GET is intentionally left unchanged: it ignores `ctx`, and keeping it header-free lets SWR share its cache across users.)

**Files:**
- Modify: `packages/client/src/impl.ts`
- Create: `.changeset/forward-useuploadstuff-headers.md`

**Interfaces:**
- Produces: `useUploadStuff(endpoint, { headers })` and `startUpload(files, input, { headers })` now attach those headers to the init/complete requests. Per-call `headers` shallow-overrides hook-level `headers`. No type changes (the options already exist).

- [ ] **Step 1: Add a header-merge helper**

Add this near the other module-level helpers (e.g. above `uploadFileWithProgress`) in `packages/client/src/impl.ts`:

```ts
const mergeHeaders = (...inits: Array<HeadersInit | undefined>): Record<string, string> => {
  const out = new Headers();
  for (const init of inits) {
    if (!init) continue;
    new Headers(init).forEach((value, key) => out.set(key, value));
  }
  return Object.fromEntries(out.entries());
};
```

- [ ] **Step 2: Build the request headers inside `startUpload` and forward them**

In `startUpload` (the `useCallback<StartUploadFn<TRoute>>` body), after `isUploadingRef.current = true;`, compute the headers once:

```ts
const requestHeaders = mergeHeaders(opts?.headers, runOpts?.headers);
```

Then pass them as the `hc` per-call options (second argument) on both mutations. Change the `initMutation` call to:

```ts
const uploadPlan = await initMutation(
  {
    param: {
      endpoint: resolvedEndpoint as string,
    },
    json: {
      input: input ?? null,
      files: meta,
    },
  },
  { headers: requestHeaders },
);
```

and the `completeMutation` call to:

```ts
const verified = await completeMutation(
  {
    param: {
      endpoint: resolvedEndpoint as string,
    },
    json: {
      batchId: uploadPlan.batchId,
    },
  },
  { headers: requestHeaders },
);
```

(`initMutation`/`completeMutation` already forward via `(...args) => ...$post(...args)`, so the second argument reaches `hc`'s `ClientRequestOptions.headers` with no wrapper change.)

- [ ] **Step 3: Add the changeset**

Create `.changeset/forward-useuploadstuff-headers.md`:

```md
---
"@upload-stuff/client": patch
---

`useUploadStuff` now forwards its `headers` option (and `startUpload`'s per-call
`headers`) to the init-upload and complete-upload requests, so consumers can attach
auth/identity headers to the upload lifecycle.
```

- [ ] **Step 4: Type-check the client package**

Run: `pnpm -F @upload-stuff/client check-types`
Expected: PASS (no errors).

- [ ] **Step 5: Build all packages (the example consumes built `dist`)**

Run: `pnpm -F './packages/*' build`
Expected: all three packages build; `packages/client/dist` and `packages/server/dist` updated.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/impl.ts .changeset/forward-useuploadstuff-headers.md
git commit -m "feat(client): forward useUploadStuff headers option to upload requests

Claude-Session: https://claude.ai/code/session_01Jd2koGXFqNumUEnyw9sn6j"
```

---

### Task 2: Scaffold the example app + register the `examples/*` workspace

Create the Next app skeleton and make pnpm aware of the new root folder. End state: `next build` of an empty-but-valid app succeeds.

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `examples/kitchen-sink/package.json`
- Create: `examples/kitchen-sink/tsconfig.json`
- Create: `examples/kitchen-sink/next.config.mjs`
- Create: `examples/kitchen-sink/.gitignore`
- Create: `examples/kitchen-sink/.oxlintrc.json`
- Create: `examples/kitchen-sink/app/layout.tsx`
- Create: `examples/kitchen-sink/app/globals.css`
- Create: `examples/kitchen-sink/app/page.tsx` (temporary placeholder, replaced in Task 5)

**Interfaces:**
- Produces: a buildable Next app at `examples/kitchen-sink`, package name `@upload-stuff/example-kitchen-sink`, with `@/*` resolving to the app root.

- [ ] **Step 1: Add the workspace glob**

Edit `pnpm-workspace.yaml` to:

```yaml
packages:
  - "packages/*"
  - "apps/*"
  - "examples/*"
```

- [ ] **Step 2: Create `examples/kitchen-sink/package.json`**

```json
{
  "name": "@upload-stuff/example-kitchen-sink",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "predev": "docker compose up -d --wait && prisma db push --skip-generate && prisma generate",
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "db:push": "prisma db push",
    "lint": "oxlint"
  },
  "dependencies": {
    "@prisma/client": "^6.1.0",
    "@upload-stuff/client": "workspace:*",
    "@upload-stuff/core": "workspace:*",
    "@upload-stuff/server": "workspace:*",
    "@aws-sdk/client-s3": "^3.896.0",
    "@aws-sdk/s3-request-presigner": "^3.896.0",
    "next": "16.2.9",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "zod": "4.1.11"
  },
  "devDependencies": {
    "@types/node": "^25.9.2",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "oxlint": "^1.69.0",
    "prisma": "^6.1.0",
    "typescript": "5.9.3"
  }
}
```

(`@aws-sdk/*` are direct deps here because the example uses the optional-peer `s3Adapter`. `@prisma/client`/`prisma` `^6` provides `updateManyAndReturn` and is `>=5.16`-compatible with the adapter.)

- [ ] **Step 3: Create `examples/kitchen-sink/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "paths": {
      "@/*": ["./*"]
    },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create `examples/kitchen-sink/next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  transpilePackages: [
    "@upload-stuff/core",
    "@upload-stuff/server",
    "@upload-stuff/client",
  ],
};

export default config;
```

- [ ] **Step 5: Create `examples/kitchen-sink/.gitignore`**

```
.next
next-env.d.ts
node_modules
dev.db
*.tsbuildinfo
```

- [ ] **Step 6: Create `examples/kitchen-sink/.oxlintrc.json`**

```json
{
  "$schema": "https://raw.githubusercontent.com/oxc-project/oxc/main/npm/oxlint/configuration_schema.json",
  "ignorePatterns": [".next", "node_modules"]
}
```

- [ ] **Step 7: Create `examples/kitchen-sink/app/globals.css`**

```css
:root {
  color-scheme: light dark;
  font-family: system-ui, -apple-system, sans-serif;
}
body {
  margin: 0;
  padding: 2rem;
  max-width: 760px;
  margin-inline: auto;
  line-height: 1.5;
}
button {
  cursor: pointer;
  padding: 0.4rem 0.8rem;
  border-radius: 6px;
  border: 1px solid currentColor;
  background: transparent;
}
button[aria-pressed="true"] {
  font-weight: 700;
  outline: 2px solid currentColor;
}
.card {
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  border-radius: 10px;
  padding: 1rem;
  margin-block: 1rem;
}
.row {
  display: flex;
  gap: 1rem;
  align-items: center;
  flex-wrap: wrap;
}
pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.8rem;
}
.bar {
  height: 8px;
  background: color-mix(in srgb, currentColor 20%, transparent);
  border-radius: 4px;
  overflow: hidden;
}
.bar > span {
  display: block;
  height: 100%;
  background: currentColor;
}
img.preview {
  max-width: 240px;
  border-radius: 8px;
  display: block;
}
```

- [ ] **Step 8: Create `examples/kitchen-sink/app/layout.tsx`**

```tsx
import "./globals.css";

export const metadata = {
  title: "upload-stuff — kitchen sink example",
  description: "Full upload-stuff API against local MinIO + Postgres",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 9: Create a temporary `examples/kitchen-sink/app/page.tsx`**

```tsx
export default function Page() {
  return <h1>upload-stuff kitchen sink — scaffold</h1>;
}
```

- [ ] **Step 10: Install and build the skeleton**

Run: `pnpm install`
Expected: lockfile updates; `@upload-stuff/example-kitchen-sink` linked.

Run: `pnpm -F @upload-stuff/example-kitchen-sink build`
Expected: `next build` succeeds (compiles the placeholder page).

- [ ] **Step 11: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml examples/kitchen-sink
git commit -m "feat(example): scaffold examples/kitchen-sink Next app + examples/* workspace

Claude-Session: https://claude.ai/code/session_01Jd2koGXFqNumUEnyw9sn6j"
```

---

### Task 3: Local infrastructure — Docker Compose (Postgres + MinIO) + Prisma schema

Stand up the backing services and the `File` table so later tasks can type-check against the generated Prisma client and hit real storage.

**Files:**
- Create: `examples/kitchen-sink/docker-compose.yml`
- Create: `examples/kitchen-sink/.env`
- Create: `examples/kitchen-sink/prisma/schema.prisma`

**Interfaces:**
- Produces: a `postgres` reachable at `postgresql://postgres:postgres@localhost:5432/upload_stuff`; a MinIO at `http://localhost:9000` (console `:9001`) with a public-download `uploads` bucket; a generated `@prisma/client` exposing the `File` model with a `caption` column.

- [ ] **Step 1: Create `examples/kitchen-sink/docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: upload_stuff
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d upload_stuff"]
      interval: 2s
      timeout: 3s
      retries: 30

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
      MINIO_API_CORS_ALLOW_ORIGIN: "*"
    ports:
      - "9000:9000"
      - "9001:9001"

  minio-setup:
    image: minio/mc
    depends_on:
      - minio
    entrypoint: >
      /bin/sh -c "
      until mc alias set local http://minio:9000 minioadmin minioadmin; do
        echo 'waiting for minio...'; sleep 1;
      done;
      mc mb --ignore-existing local/uploads;
      mc anonymous set download local/uploads;
      echo 'minio ready';
      "
```

(`docker compose up -d --wait` returns once `postgres` is healthy and the one-shot `minio-setup` has exited 0 — which only happens after MinIO is reachable and the public bucket exists.)

- [ ] **Step 2: Create `examples/kitchen-sink/.env`**

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/upload_stuff"
```

- [ ] **Step 3: Create `examples/kitchen-sink/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

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
  scope             String?
  caption           String?
  createdAt         DateTime  @default(now())
}
```

- [ ] **Step 4: Bring up infra**

Run: `cd examples/kitchen-sink && docker compose up -d --wait`
Expected: `postgres` healthy; `minio-setup` exits with code 0; `minio` running. (`docker compose ps` shows postgres `healthy`, minio `running`.)

- [ ] **Step 5: Push schema + generate client**

Run (from `examples/kitchen-sink`): `pnpm exec prisma db push`
Expected: "Your database is now in sync with your Prisma schema"; the `File` table is created; `@prisma/client` is generated.

- [ ] **Step 6: Verify the bucket policy + table**

Run: `docker compose exec -T minio mc --version || true` then verify the public bucket via an anonymous probe:
Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9000/uploads/`
Expected: `200` or `403`-with-listing-disabled but NOT a connection error (MinIO is reachable; anonymous download policy is set — a missing object later returns 404, which is correct).

Run: `docker compose exec -T postgres psql -U postgres -d upload_stuff -c "\d \"File\""`
Expected: the `File` table lists the columns above, including `caption` and `scope`.

- [ ] **Step 7: Commit**

```bash
git add examples/kitchen-sink/docker-compose.yml examples/kitchen-sink/.env examples/kitchen-sink/prisma/schema.prisma
git commit -m "feat(example): add postgres+minio compose and Prisma File schema

Claude-Session: https://claude.ai/code/session_01Jd2koGXFqNumUEnyw9sn6j"
```

---

### Task 4: Server wiring — instance, router, Next handler, files endpoint

Build the curried instance with the shipped adapters, the one kitchen-sink route, the upload handler, and a per-user files listing. End state: live endpoints answer correctly via `curl`.

**Files:**
- Create: `examples/kitchen-sink/lib/prisma.ts`
- Create: `examples/kitchen-sink/lib/upload-stuff.ts`
- Create: `examples/kitchen-sink/lib/file-router.ts`
- Create: `examples/kitchen-sink/app/api/upload-stuff/[...uploadStuff]/route.ts`
- Create: `examples/kitchen-sink/app/api/files/route.ts`

**Interfaces:**
- Consumes: `UploadStuff`, `createUploadStuffRouter` from `@upload-stuff/server`; `s3Adapter` from `@upload-stuff/server/adapters/s3`; `prismaAdapter` from `@upload-stuff/server/adapters/prisma`; `toNextJsHandler` from `@upload-stuff/server/next`; the generated `PrismaClient`.
- Produces: `uploadStuff` (instance), `fileRouter` + `type FileRouter` (consumed by Task 5's client + Task 6), `GET`/`POST` at `/api/upload-stuff/*`, `GET /api/files`. The route key is `image`; its input schema is `{ caption: string }`; `onUploadComplete` returns `{ owner: string; count: number }`.

- [ ] **Step 1: Create `examples/kitchen-sink/lib/prisma.ts`**

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 2: Create `examples/kitchen-sink/lib/upload-stuff.ts`**

```ts
import { UploadStuff } from "@upload-stuff/server";
import { s3Adapter } from "@upload-stuff/server/adapters/s3";
import { prismaAdapter } from "@upload-stuff/server/adapters/prisma";

import { prisma } from "./prisma";

// Local-only, non-secret MinIO defaults. Both the browser PUT and the server-side
// HEAD use this same localhost origin (Next runs on the host, not in Compose).
const MINIO_ENDPOINT = "http://localhost:9000";
const BUCKET = "uploads";

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
  databaseAdapter: prismaAdapter({ prisma }),
  filePublicUrlGenerator: ({ key }) => `${MINIO_ENDPOINT}/${BUCKET}/${key}`,
  // Central typed custom column declaration.
  fields: {
    caption: { type: "string", required: false },
  },
  // Typed against `fields`: file.scope is string|undefined, file.caption is string|undefined.
  objectMetadata: (file) => ({
    owner: file.scope ?? "",
    caption: file.caption ?? "",
  }),
});
```

- [ ] **Step 3: Create `examples/kitchen-sink/lib/file-router.ts`**

```ts
import { z } from "zod";

import { createUploadStuffRouter } from "@upload-stuff/server";

import { uploadStuff } from "./upload-stuff";

type Context = { userId: string };

const f = createUploadStuffRouter<Context, typeof uploadStuff>();

export const fileRouter = {
  image: f({
    isPublic: true,
    type: "image",
    usageContext: "image",
    maxFileSize: "8MB",
    maxFileCount: 1,
  })
    .input(z.object({ caption: z.string() }))
    // Ownership: only the same user can finalize their own in-flight batch.
    .scope(({ ctx }) => ctx.userId)
    // Persist the declared `caption` column from the validated input.
    .fields(({ input }) => ({ caption: input.caption }))
    .middleware(({ ctx }) => ({ userId: ctx.userId }))
    .onUploadComplete(({ files, middlewareData }) => ({
      owner: middlewareData.userId,
      count: files.length,
    }))
    .build(),
};

export type FileRouter = typeof fileRouter;
```

- [ ] **Step 4: Create `examples/kitchen-sink/app/api/upload-stuff/[...uploadStuff]/route.ts`**

```ts
import { toNextJsHandler } from "@upload-stuff/server/next";

import { uploadStuff } from "@/lib/upload-stuff";
import { fileRouter } from "@/lib/file-router";

export const { GET, POST } = toNextJsHandler({
  uploadStuff,
  fileRouter,
  config: {},
  // No real auth: derive the user id straight from a request header.
  createContext: async ({ headers }) => ({
    userId: headers.get("x-user-id") ?? "anon",
  }),
});
```

- [ ] **Step 5: Create `examples/kitchen-sink/app/api/files/route.ts`**

```ts
import { prisma } from "@/lib/prisma";

// List the current user's stored files. Scope = the x-user-id header, mirroring
// the upload route's createContext, so the gallery is owner-scoped end to end.
export async function GET(req: Request) {
  const userId = req.headers.get("x-user-id") ?? "anon";

  const files = await prisma.file.findMany({
    where: { scope: userId, stored: true },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      filename: true,
      caption: true,
      scope: true,
      contentType: true,
      publicUrl: true,
      createdAt: true,
    },
  });

  return Response.json({ files });
}
```

- [ ] **Step 6: Type-check the app**

Run: `pnpm -F @upload-stuff/example-kitchen-sink exec tsc --noEmit`
Expected: PASS. (If `@prisma/client` types are missing, re-run `pnpm -F @upload-stuff/example-kitchen-sink exec prisma generate` — Task 3 Step 5.)

- [ ] **Step 7: Start the dev server and verify endpoints**

Ensure infra is up (`cd examples/kitchen-sink && docker compose up -d --wait`), then run the dev server in the background:
Run: `pnpm -F @upload-stuff/example-kitchen-sink dev`

Verify the route-config endpoint:
Run: `curl -s http://localhost:3000/api/upload-stuff/image/route-config`
Expected: JSON containing `"usageContext":"image"`, `"type":"image"`, `"maxFileSize":"8MB"`, `"isPublic":true`.

Verify init-upload returns a presigned MinIO URL (proves instance + s3Adapter + DB insert):
Run:
```bash
curl -s -X POST http://localhost:3000/api/upload-stuff/image/init-upload \
  -H 'content-type: application/json' -H 'x-user-id: user-a' \
  -d '{"input":{"caption":"hello"},"files":[{"filename":"t.png","contentType":"image/png","size":70}]}'
```
Expected: JSON with `batchId` and `files[0].uploadUrl` starting `http://localhost:9000/uploads/`, plus `files[0].uploadHeaders` containing `x-amz-meta-owner`/`x-amz-meta-caption`.

Verify the row landed scoped to `user-a`:
Run: `docker compose -f examples/kitchen-sink/docker-compose.yml exec -T postgres psql -U postgres -d upload_stuff -c "select scope, caption, stored from \"File\";"`
Expected: one row, `scope = user-a`, `caption = hello`, `stored = f`.

- [ ] **Step 8: Commit**

```bash
git add examples/kitchen-sink/lib examples/kitchen-sink/app/api
git commit -m "feat(example): wire UploadStuff instance, router, Next handler, files endpoint

Claude-Session: https://claude.ai/code/session_01Jd2koGXFqNumUEnyw9sn6j"
```

---

### Task 5: Client helper + main UI (switcher, upload panel, gallery)

Add the typed client helper and the page: a current-user switcher, an upload panel (picker + caption + progress + serverData + rendered image), and a per-user gallery.

**Files:**
- Create: `examples/kitchen-sink/lib/users.ts`
- Create: `examples/kitchen-sink/lib/upload-stuff-client.ts`
- Create: `examples/kitchen-sink/app/upload-panel.tsx`
- Create: `examples/kitchen-sink/app/gallery.tsx`
- Modify (replace placeholder): `examples/kitchen-sink/app/page.tsx`

**Interfaces:**
- Consumes: `createUploadStuffReactHelpers` from `@upload-stuff/client`; `type FileRouter` from `@/lib/file-router` (type-only import — erased, so no server code reaches the client bundle); `GET /api/files` from Task 4.
- Produces: `useUploadStuff` (typed to `FileRouter`); `USERS`/`UserId`; React components `UploadPanel`, `Gallery`; a working page wiring user state + a `refreshKey` bumped on each completed upload.

- [ ] **Step 1: Create `examples/kitchen-sink/lib/users.ts`**

```ts
export const USERS = ["user-a", "user-b"] as const;
export type UserId = (typeof USERS)[number];
```

- [ ] **Step 2: Create `examples/kitchen-sink/lib/upload-stuff-client.ts`**

```ts
"use client";

import { createUploadStuffReactHelpers } from "@upload-stuff/client";

import type { FileRouter } from "./file-router";

// Same-origin: a relative basePath resolved against the current origin. The
// localhost fallback is only used when this module is evaluated during SSR; the
// hc client is never actually called from the server.
export const { useUploadStuff } = createUploadStuffReactHelpers<FileRouter>({
  baseURL: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
});
```

- [ ] **Step 3: Create `examples/kitchen-sink/app/upload-panel.tsx`**

```tsx
"use client";

import { useState } from "react";

import { useUploadStuff } from "@/lib/upload-stuff-client";

export function UploadPanel({ user, onUploaded }: { user: string; onUploaded: () => void }) {
  const [caption, setCaption] = useState("");
  const [progress, setProgress] = useState(0);
  const [serverData, setServerData] = useState<{ owner: string; count: number } | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { startUpload, isUploading, isLoading, accept } = useUploadStuff((r) => r.image, {
    headers: { "x-user-id": user },
    uploadProgressGranularity: "fine",
    onUploadProgress: setProgress,
    onClientUploadComplete: (res) => {
      setServerData(res.serverData ?? null);
      setImageUrl(res.files[0]?.publicUrl ?? null);
      onUploaded();
    },
    onUploadError: (e) => setError(e.message),
  });

  return (
    <div className="card">
      <h2>Upload an image (as {user})</h2>
      <div className="row">
        <input
          type="text"
          placeholder="caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
        />
        <input
          type="file"
          accept={accept}
          disabled={isUploading || isLoading}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length === 0) return;
            setError(null);
            setServerData(null);
            setImageUrl(null);
            void startUpload(files, { caption });
          }}
        />
      </div>

      {isUploading && (
        <div className="bar" aria-label="upload progress">
          <span style={{ width: `${progress}%` }} />
        </div>
      )}

      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}

      {serverData && (
        <pre>onUploadComplete serverData → {JSON.stringify(serverData, null, 2)}</pre>
      )}

      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="preview" src={imageUrl} alt="uploaded" />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `examples/kitchen-sink/app/gallery.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";

type Row = {
  id: string;
  filename: string;
  caption: string | null;
  scope: string | null;
  contentType: string;
  publicUrl: string;
  createdAt: string;
};

export function Gallery({ user, refreshKey }: { user: string; refreshKey: number }) {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/files", { headers: { "x-user-id": user } })
      .then((r) => r.json())
      .then((d: { files: Row[] }) => {
        if (active) setRows(d.files);
      })
      .catch(() => {
        if (active) setRows([]);
      });
    return () => {
      active = false;
    };
  }, [user, refreshKey]);

  return (
    <div className="card">
      <h2>{user}&apos;s stored files ({rows.length})</h2>
      {rows.length === 0 && <p>No files yet for this user.</p>}
      {rows.map((row) => (
        <div key={row.id} className="row" style={{ marginBlock: "0.75rem" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="preview" src={row.publicUrl} alt={row.filename} style={{ maxWidth: 120 }} />
          <pre>
            {JSON.stringify(
              { caption: row.caption, scope: row.scope, contentType: row.contentType },
              null,
              2,
            )}
          </pre>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Replace `examples/kitchen-sink/app/page.tsx`**

```tsx
"use client";

import { useState } from "react";

import { USERS, type UserId } from "@/lib/users";
import { UploadPanel } from "./upload-panel";
import { Gallery } from "./gallery";

export default function Page() {
  const [user, setUser] = useState<UserId>("user-a");
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <main>
      <h1>upload-stuff — kitchen sink</h1>
      <p>Local MinIO + Postgres. Identity is the selected user, sent as an x-user-id header.</p>

      <div className="card">
        <strong>Current user:</strong>
        <div className="row" style={{ marginTop: "0.5rem" }}>
          {USERS.map((u) => (
            <button key={u} aria-pressed={u === user} onClick={() => setUser(u)}>
              {u}
            </button>
          ))}
        </div>
      </div>

      <UploadPanel user={user} onUploaded={() => setRefreshKey((k) => k + 1)} />
      <Gallery user={user} refreshKey={refreshKey} />
    </main>
  );
}
```

- [ ] **Step 6: Type-check + lint**

Run: `pnpm -F @upload-stuff/example-kitchen-sink exec tsc --noEmit`
Expected: PASS.
Run: `pnpm -F @upload-stuff/example-kitchen-sink lint`
Expected: no errors.

- [ ] **Step 7: Browser end-to-end (Claude-in-Chrome)**

With infra up and `pnpm -F @upload-stuff/example-kitchen-sink dev` running, open `http://localhost:3000`. As `user-a`: type a caption, pick an image. Confirm: progress bar advances to 100%; the `serverData` shows `{ "owner": "user-a", "count": 1 }`; the uploaded image renders (served from MinIO, proving the public bucket + presigned PUT + CORS path all work); a new row appears in the `user-a` gallery with the caption + `scope: user-a`. Switch to `user-b`: the gallery shows no files (or only user-b's). Switch back to `user-a`: the file is still listed.

This step is also the verification of Task 1 (the `x-user-id` header must reach the server for the row to be scoped to `user-a`).

- [ ] **Step 8: Commit**

```bash
git add examples/kitchen-sink/lib/users.ts examples/kitchen-sink/lib/upload-stuff-client.ts examples/kitchen-sink/app/upload-panel.tsx examples/kitchen-sink/app/gallery.tsx examples/kitchen-sink/app/page.tsx
git commit -m "feat(example): client helper + upload panel, gallery, user switcher UI

Claude-Session: https://claude.ai/code/session_01Jd2koGXFqNumUEnyw9sn6j"
```

---

### Task 6: Hijack panel — prove the `.scope()` ownership guard

A raw-`fetch` panel that initializes a batch as `user-a`, uploads the bytes, then tries to complete as `user-b` (must fail) and as `user-a` (must succeed). The hook's flow is atomic, so this deliberately bypasses it.

**Files:**
- Create: `examples/kitchen-sink/app/hijack-panel.tsx`
- Modify: `examples/kitchen-sink/app/page.tsx` (render `<HijackPanel />`)

**Interfaces:**
- Consumes: the public endpoints `/api/upload-stuff/image/init-upload`, the presigned `uploadUrl` + `uploadHeaders` it returns, and `/api/upload-stuff/image/complete-upload`.
- Produces: a `HijackPanel` component; no exports consumed elsewhere.

- [ ] **Step 1: Create `examples/kitchen-sink/app/hijack-panel.tsx`**

```tsx
"use client";

import { useState } from "react";

// A 1x1 transparent PNG (70 bytes) used as the in-flight payload.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function pngFile() {
  const bytes = Uint8Array.from(atob(PNG_BASE64), (c) => c.charCodeAt(0));
  return new File([bytes], "hijack.png", { type: "image/png" });
}

export function HijackPanel() {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const append = (line: string) => setLog((l) => [...l, line]);

  async function run() {
    setBusy(true);
    setLog([]);
    try {
      const file = pngFile();

      // 1. init the batch as user-a
      const initRes = await fetch("/api/upload-stuff/image/init-upload", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "user-a" },
        body: JSON.stringify({
          input: { caption: "hijack test" },
          files: [{ filename: file.name, contentType: file.type, size: file.size }],
        }),
      });
      const initData = await initRes.json();
      const plan = initData.files[0];
      append(`1. init as user-a → batchId ${initData.batchId}`);

      // 2. upload the bytes to MinIO (replaying the signed metadata headers)
      await fetch(plan.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type, ...(plan.uploadHeaders ?? {}) },
        body: file,
      });
      append("2. uploaded bytes to storage");

      // 3. try to complete as user-b — the scope guard must reject this
      const bRes = await fetch("/api/upload-stuff/image/complete-upload", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "user-b" },
        body: JSON.stringify({ batchId: initData.batchId }),
      });
      const bBody = await bRes.json();
      append(
        `3. complete as user-b → HTTP ${bRes.status} ${
          bRes.ok ? "OK (UNEXPECTED!)" : "rejected ✓"
        } ${JSON.stringify(bBody)}`,
      );

      // 4. complete as the real owner — must succeed
      const aRes = await fetch("/api/upload-stuff/image/complete-upload", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "user-a" },
        body: JSON.stringify({ batchId: initData.batchId }),
      });
      const aBody = await aRes.json();
      append(
        `4. complete as user-a → HTTP ${aRes.status} ${
          aRes.ok ? "success ✓" : "FAILED (UNEXPECTED!)"
        } ${JSON.stringify(aBody)}`,
      );
    } catch (e) {
      append(`error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Ownership guard (hijack attempt)</h2>
      <p>
        Init a batch as <code>user-a</code>, upload bytes, then try to finalize it as{" "}
        <code>user-b</code> (must fail) and as <code>user-a</code> (must succeed).
      </p>
      <button onClick={() => void run()} disabled={busy}>
        {busy ? "running…" : "Run hijack attempt"}
      </button>
      {log.length > 0 && <pre>{log.join("\n")}</pre>}
    </div>
  );
}
```

- [ ] **Step 2: Render it on the page**

In `examples/kitchen-sink/app/page.tsx`, add the import and render below `<Gallery />`:

```tsx
import { HijackPanel } from "./hijack-panel";
```

```tsx
      <Gallery user={user} refreshKey={refreshKey} />
      <HijackPanel />
```

- [ ] **Step 3: Type-check**

Run: `pnpm -F @upload-stuff/example-kitchen-sink exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Browser end-to-end (Claude-in-Chrome)**

On `http://localhost:3000`, click "Run hijack attempt". Confirm the log shows: step 3 `complete as user-b → HTTP 400 rejected ✓ {"error":"No files found"}` and step 4 `complete as user-a → HTTP 200 success ✓` with the files array. This proves `.scope()` rejects a different principal finalizing an in-flight batch.

- [ ] **Step 5: Commit**

```bash
git add examples/kitchen-sink/app/hijack-panel.tsx examples/kitchen-sink/app/page.tsx
git commit -m "feat(example): add ownership-guard hijack demonstration panel

Claude-Session: https://claude.ai/code/session_01Jd2koGXFqNumUEnyw9sn6j"
```

---

### Task 7: README + full fresh-run verification

Document the run steps and verify the whole thing works from a clean state.

**Files:**
- Create: `examples/kitchen-sink/README.md`

**Interfaces:**
- Consumes: everything built in Tasks 1–6.
- Produces: run documentation; no code exports.

- [ ] **Step 1: Create `examples/kitchen-sink/README.md`**

```md
# upload-stuff — kitchen sink example

A Next.js App Router app exercising the full `upload-stuff` API end to end against a
local MinIO (S3-compatible) and Postgres, using the shipped `s3Adapter` and
`prismaAdapter`. Pick an image, upload it, watch progress, see it rendered back and
its persisted DB row — plus a per-user gallery and a `.scope()` ownership-guard demo.

## What it demonstrates

- Curried `UploadStuff<"image">()` with a central typed `fields` (`caption`) and a
  typed `objectMetadata` resolver (`owner` + `caption` → S3 object metadata).
- A file route using `.input()`, `.scope()`, `.fields()`, `.middleware()`, and
  `.onUploadComplete()`.
- The Next.js handler with `createContext` reading the user id from an `x-user-id`
  header.
- The typed `useUploadStuff` hook: upload progress, the server `onUploadComplete`
  result, and the stored image.
- Ownership: a per-user scoped gallery, and a hijack panel proving a second user
  cannot finalize another user's in-flight batch.

## Prerequisites

- Docker running (for Postgres + MinIO).
- pnpm + Node (repo toolchain).

## Run

From the repo root:

```sh
pnpm install
pnpm -F './packages/*' build          # build the workspace libraries first
pnpm --filter @upload-stuff/example-kitchen-sink dev
```

`dev` runs `predev` automatically: `docker compose up -d --wait` (Postgres + MinIO +
a one-shot `mc` that creates the public `uploads` bucket), then `prisma db push` and
`prisma generate`. Then open http://localhost:3000.

MinIO console: http://localhost:9001 (`minioadmin` / `minioadmin`).

To stop the infra: `cd examples/kitchen-sink && docker compose down` (add `-v` to wipe
the data volumes).

## Notes

- Credentials here are throwaway local defaults — no real auth, no secrets.
- The `File` schema is created with `prisma db push` (no migrations folder).
```

- [ ] **Step 2: Clean-state verification**

Tear down and bring everything up as a fresh clone would:
Run: `cd examples/kitchen-sink && docker compose down -v`
Run (repo root): `pnpm -F './packages/*' build`
Run: `pnpm --filter @upload-stuff/example-kitchen-sink dev` (this triggers `predev`)
Expected: compose comes up healthy, schema pushes, `next dev` serves on :3000.

- [ ] **Step 3: Full end-to-end pass (Claude-in-Chrome)**

On a fresh DB: as `user-a` upload an image with a caption → progress reaches 100%, serverData `{owner:"user-a",count:1}`, image renders, gallery row present with `scope:user-a`. Switch to `user-b` → empty gallery. Run the hijack panel → user-b complete rejected (HTTP 400), user-a complete succeeds (HTTP 200). Finally confirm persistence directly:
Run: `docker compose -f examples/kitchen-sink/docker-compose.yml exec -T postgres psql -U postgres -d upload_stuff -c "select scope, caption, stored, \"contentType\" from \"File\" order by \"createdAt\";"`
Expected: rows for `user-a` with the caption and `stored = t`.

- [ ] **Step 4: Commit**

```bash
git add examples/kitchen-sink/README.md
git commit -m "docs(example): add kitchen-sink README with run steps

Claude-Session: https://claude.ai/code/session_01Jd2koGXFqNumUEnyw9sn6j"
```

---

## Risks & mitigations (verify during build)

- **MinIO CORS on the browser presigned PUT** (custom `x-amz-meta-*` headers trigger a preflight). Mitigation: `MINIO_API_CORS_ALLOW_ORIGIN: "*"` on the `minio` service. If the PUT still fails preflight in Task 5/6, set a specific origin (`http://localhost:3000`) or configure CORS via `mc`.
- **Public render of objects.** Relies on `mc anonymous set download local/uploads` (Task 3). The canned `public-read` ACL the adapter sets is not relied upon. If `<img>` 403s, re-check the bucket policy.
- **`forcePathStyle`** must be `true` or the SDK builds virtual-host-style URLs MinIO can't serve. Set in Task 4 Step 2.
- **Prisma client generation ordering.** `tsc`/`next build` need the generated client; Task 3 generates it before Task 4 type-checks. If types go missing after a clean, re-run `prisma generate`.
- **SSR evaluation of the client helper.** `createUploadStuffReactHelpers` runs at module load; the `http://localhost:3000` fallback keeps `new URL()` valid server-side (the client is only actually called in the browser).

## Self-review notes

- **Spec coverage:** storage=MinIO via s3Adapter (T3/T4) ✓; db=Postgres via prismaAdapter (T3/T4) ✓; curried instance + fields + objectMetadata (T4) ✓; route .input/.scope/.fields/.middleware/.onUploadComplete (T4) ✓; createContext reads x-user-id (T4) ✓; client headers forwarding + changeset (T1) ✓; UI switcher/progress/serverData/image/gallery (T5) ✓; hijack stretch (T6) ✓; one-command run + README (T2/T3/T7) ✓; examples/* placement + package name (T2) ✓.
- **Type consistency:** route key `image`; input `{caption:string}`; `onUploadComplete` → `{owner:string,count:number}` used identically in T4/T5; gallery `Row` matches the `select` in `/api/files`; `useUploadStuff` selector form `(r)=>r.image` matches `FileRouter`.
- **Placeholders:** none — every file's full contents are given.
```
