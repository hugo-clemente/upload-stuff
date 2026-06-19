---
date: 2026-06-19
topic: fullstack-example
---

# Kitchen-sink fullstack example (`examples/kitchen-sink`)

## Summary

A Next.js App Router example at `examples/kitchen-sink` that exercises the full `upload-stuff`
API end to end against realistic, S3-compatible infrastructure: the shipped
`s3Adapter` pointed at a local **MinIO**, the shipped `prismaAdapter` pointed at a
local **Postgres**, both stood up by a single `docker-compose.yml`. The user picks an
image, uploads it through the typed React hook, watches progress, and sees the
rendered image, the server `onUploadComplete` result, and the persisted DB row. The
example also demonstrates the `.scope()` ownership guard, including a deliberate
"hijack" attempt proving a second user cannot finalize another user's in-flight batch.

The one library change required: wire the already-declared-but-inert `headers` option
on `useUploadStuff` through to the network calls, so the client can send an
`x-user-id` header. Everything else uses the public API as published.

## Goal

- One command (`pnpm --filter @upload-stuff/example-kitchen-sink dev`) brings up infra, applies the schema, and runs
  the app. The only prerequisite is a running Docker daemon.
- Exercise every new API surface: curried instance creation, central typed `fields`,
  a typed `objectMetadata` resolver, and a route using `.input()`, `.scope()`,
  `.fields()`, `.middleware()`, and `.onUploadComplete()`.
- Use the **shipped reference adapters** (`s3Adapter`, `prismaAdapter`) so the example
  doubles as a faithful integration-test surface for the real upload code paths —
  including the genuine presigned-PUT flow where the client must replay the signed
  `x-amz-meta-*` headers, which is what truly exercises `objectMetadata`.
- Keep it small and readable. It is a demo/testing surface, not production.

## Key Decisions

- **Realistic infra over zero-dependency.** Earlier framing targeted a bespoke
  local-filesystem `StorageAdapter` + sqlite for a zero-service run. Replaced, at the
  user's direction, with MinIO + Postgres via Docker Compose. Rationale: it exercises
  the shipped `s3Adapter`/`prismaAdapter` (the code real users run), and the presigned
  `x-amz-meta-*` signature/replay path makes `objectMetadata` genuinely tested instead
  of simulated. The bespoke local-FS adapter is dropped entirely (not kept as a
  reference).

- **Identity travels as an `x-user-id` header, set by the client.** The spec wants
  `createContext` to read the user id from a request header. The hook currently cannot
  send one: `useUploadStuff`'s `headers` option (`packages/client/src/impl.ts:294`) and
  `startUpload`'s `headers` option (`:318`) are declared in the types but never
  forwarded to the `init-upload`/`complete-upload`/`route-config` calls — only the
  storage `requiredHeaders` are replayed on the PUT (`:419`). Decision: forward the
  merged headers (hook-level option, overridden per-call by `startUpload`) to those
  three Hono RPC calls. This is the only change under `packages/`. Cookies +
  middleware were rejected because direct header support is cleaner and the option
  already exists in the public type.

- **One file route, configured public, used as the kitchen sink.** A single `image`
  route exercises `.input()`, `.scope()`, `.fields()`, `.middleware()`, and
  `.onUploadComplete()`. `isPublic: true` so the rendered `<img>` can read the object
  anonymously.

- **Per-user scoped gallery as the everyday scope demonstration; raw-fetch hijack
  panel as the adversarial proof.** The hook's `startUpload` is atomic
  (init → PUT → complete in one call), so a user switch cannot be interleaved between
  PUT and complete through the hook. The hijack proof therefore uses raw `fetch` against
  the public endpoints.

- **No manual configuration steps.** Local-only, non-secret credentials
  (`minioadmin` / Postgres dev creds) are committed (`.env` + compose). `prisma db push`
  creates the schema on `predev` — no migrations folder to maintain. The bucket and its
  public-download policy are created by a one-shot `mc` container in compose.

## Architecture

### File layout

```
examples/kitchen-sink/
  package.json            # next, react, @prisma/client, prisma, zod, workspace deps
  next.config.mjs
  tsconfig.json
  postcss.config.mjs  (tailwind)
  .gitignore              # .next, generated prisma client if local
  .env                    # DATABASE_URL + MinIO endpoint/creds (local-only, committed)
  docker-compose.yml      # postgres, minio, minio-setup (one-shot mc)
  prisma/
    schema.prisma         # Postgres datasource; File model + custom `caption` column
  lib/
    prisma.ts             # PrismaClient singleton
    upload-stuff.ts       # curried instance: s3Adapter(MinIO) + prismaAdapter, fields, objectMetadata
    file-router.ts        # the `image` route + FileRouter type export
    upload-stuff-client.ts# createUploadStuffReactHelpers<FileRouter>
    users.ts              # the two demo identities (user-a, user-b)
  app/
    layout.tsx
    page.tsx              # current-user switcher + UploadPanel + Gallery + HijackPanel
    upload-panel.tsx      # "use client": useUploadStuff, progress, serverData, rendered image
    gallery.tsx           # "use client": lists current user's persisted rows
    hijack-panel.tsx      # "use client": raw-fetch scope-guard demonstration
    api/
      upload-stuff/[...uploadStuff]/route.ts  # toNextJsHandler + createContext (reads x-user-id)
      files/route.ts                          # GET: rows where scope = x-user-id
  README.md               # run steps + what each part demonstrates
```

### Components

**Storage — shipped `s3Adapter` → MinIO.**
`s3Adapter({ config: { region: "us-east-1", endpoint: "http://localhost:9000", forcePathStyle: true, credentials: { accessKeyId: "minioadmin", secretAccessKey: "minioadmin" } }, bucket: "uploads" })`.
`forcePathStyle: true` is required for MinIO. Because Next runs on the host (not in
Compose) and the browser also runs on the host, both server-side `verifyUpload`
(HEAD) and the browser presigned PUT use the same `http://localhost:9000` origin, so
no host/network split is needed. `filePublicUrlGenerator: ({ key }) => \`http://localhost:9000/uploads/${key}\``
(path-style, anonymous-download bucket) so `<img>` renders.

**Database — shipped `prismaAdapter` → Postgres.**
`prisma/schema.prisma` declares a Postgres datasource and a `File` model with the
library-owned columns plus the one custom column `caption String?`. `prismaAdapter({ prisma })`.

**Instance (`lib/upload-stuff.ts`).**
```ts
UploadStuff<"image">()({
  storageAdapter: s3Adapter({ ... }),
  databaseAdapter: prismaAdapter({ prisma }),
  filePublicUrlGenerator: ({ key }) => `http://localhost:9000/uploads/${key}`,
  fields: { caption: { type: "string", required: false } },
  objectMetadata: (file) => ({ owner: file.scope ?? "", caption: file.caption ?? "" }),
})
```
Curried instance, central typed `fields`, typed `objectMetadata` (reads `file.scope`
and `file.caption`).

**Router (`lib/file-router.ts`).**
```ts
type Context = { userId: string };
const f = createUploadStuffRouter<Context, typeof uploadStuff>();
export const fileRouter = {
  image: f({ isPublic: true, type: "image", usageContext: "image", maxFileSize: "8MB", maxFileCount: 1 })
    .input(z.object({ caption: z.string() }))
    .scope(({ ctx }) => ctx.userId)
    .fields(({ input }) => ({ caption: input.caption }))
    .middleware(({ ctx }) => ({ userId: ctx.userId }))
    .onUploadComplete(({ files, middlewareData }) => ({ owner: middlewareData.userId, count: files.length }))
    .build(),
};
export type FileRouter = typeof fileRouter;
```

**Next handler (`app/api/upload-stuff/[...uploadStuff]/route.ts`).**
```ts
export const { GET, POST } = toNextJsHandler({
  uploadStuff, fileRouter, config: {},
  createContext: async ({ headers }) => ({ userId: headers.get("x-user-id") ?? "anon" }),
});
```

**Files listing (`app/api/files/route.ts`).**
A small `GET` reading `x-user-id` and returning that user's rows
(`prisma.file.findMany({ where: { scope: userId, stored: true } })`), so the gallery is
scoped per user. Returns `caption`, `scope`, `contentType`, `publicUrl`, `createdAt`.

**Client helper (`lib/upload-stuff-client.ts`).**
`createUploadStuffReactHelpers<FileRouter>({ baseURL: typeof window !== "undefined" ? location.origin : "" })`.

**UI (`app/page.tsx` + panels).**
- A "Current user" switcher (React state: `user-a` | `user-b`).
- `UploadPanel`: `useUploadStuff(r => r.image, { headers: { "x-user-id": currentUser }, onUploadProgress, onClientUploadComplete })`; file picker (`accept` from the hook), a caption input passed as `startUpload(files, { caption })`, a progress bar, the `serverData` (`{ owner, count }`), and the rendered uploaded image.
- `Gallery`: fetches `/api/files` with the `x-user-id` header; shows each persisted row (image + caption + scope). Switching user re-fetches and shows a different set.
- `HijackPanel`: see below.

### The required library change

`packages/client/src/impl.ts` — forward headers:
- Merge `opts.headers` (hook option) with `runOpts.headers` (per-`startUpload`) into a
  plain header object.
- Pass `{ headers }` as the second argument to the `init-upload` `$post`, the
  `complete-upload` `$post`, and the `route-config` `$get` (hc supports a per-call
  options arg carrying headers).
- No type changes needed — `headers?: HeadersInit` already exists on both option types.
- Add a Changeset (patch to `@upload-stuff/client`) describing "useUploadStuff now
  forwards the `headers` option to requests."
- No other file under `packages/` is touched (core, server, adapters unchanged).

## Data flow

1. Browser: user selects current identity → React state holds `user-a`/`user-b`.
2. `startUpload(files, { caption })`: hook validates files, then `POST init-upload`
   with header `x-user-id: <current>`.
3. Server `createContext` → `ctx.userId`. Route runs `.input` (caption), `.scope`
   (`ctx.userId`), `.fields` (caption), `.middleware`. Core inserts rows
   (`stored:false`, `scope`, `caption`), and `s3Adapter.generatePresignedUpload`
   returns a presigned MinIO PUT URL + `x-amz-meta-*` `requiredHeaders` derived from
   `objectMetadata`.
4. Browser PUTs the bytes to MinIO, replaying the signed `x-amz-meta-*` headers and
   `Content-Type` (XHR, drives the progress bar).
5. `POST complete-upload` with the same `x-user-id`. Server re-derives `scope`,
   `verifyUpload` HEADs the object (size/content-type), marks rows `stored`, runs
   `onUploadComplete` → returns `{ owner, count }`.
6. Hook fires `onClientUploadComplete`; UI shows progress 100%, `serverData`, and the
   image via `publicUrl`. Gallery re-fetches.

## Stretch — ownership-guard hijack (`HijackPanel`)

Demonstrates that `.scope()` prevents a different principal from finalizing an
in-flight batch, using raw `fetch` (the hook's flow is atomic and cannot interleave a
user switch):

1. `init-upload` as `user-a` (`x-user-id: user-a`) → receive `batchId` + presigned URL.
2. PUT the bytes to MinIO.
3. `complete-upload` as `user-b` → server re-derives `scope: user-b`, matches 0 rows,
   responds with the "No files found" error. Panel shows the failure.
4. `complete-upload` as `user-a` → succeeds. Panel shows the success.

This visibly proves the guard: same `batchId`, different scope, rejected.

## Infrastructure & run

**Monorepo placement**
- Examples live in a new root `examples/` folder (not `apps/`), one directory per
  example, so more examples can be added later. This first one is `examples/kitchen-sink`.
- `pnpm-workspace.yaml` gains a `- "examples/*"` glob alongside `packages/*` and `apps/*`.
- Package name: `@upload-stuff/example-kitchen-sink` (private). Note: the annotation
  requested `@upload-stuff/examples/kitchen-sink`, which is not a valid npm name (two
  slashes); confirm the final name.

**`docker-compose.yml`**
- `postgres`: official image, healthcheck (`pg_isready`), local dev creds, exposes 5432.
- `minio`: `minio/minio server /data --console-address ":9001"`, creds
  `minioadmin/minioadmin`, `MINIO_API_CORS_ALLOW_ORIGIN=*` (so browser presigned PUT +
  preflight with `x-amz-meta-*` succeeds — to be verified at build), healthcheck on
  `/minio/health/ready`, exposes 9000/9001.
- `minio-setup`: one-shot `minio/mc`, `depends_on` minio healthy; creates the `uploads`
  bucket and runs `mc anonymous set download local/uploads` so objects are publicly
  GET-able for `<img>`.

**Scripts (`examples/kitchen-sink/package.json`)**
- `"predev": "docker compose up -d --wait && prisma db push && prisma generate"`
- `"dev": "next dev"`
- `"build"`, `"start"`, `"lint"` mirroring `apps/docs`.

**`.env` (committed, local-only)**
- `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/upload_stuff"` — required
  by the Prisma datasource (`url = env("DATABASE_URL")`).
- MinIO endpoint/creds are hardcoded constants in `lib/upload-stuff.ts`
  (non-secret local defaults: `http://localhost:9000`, `minioadmin`/`minioadmin`,
  bucket `uploads`) — kept out of `.env` so the upload config reads in one place.

**Fresh-clone run**
1. `pnpm install`
2. `pnpm -F './packages/*' build`
3. `pnpm --filter @upload-stuff/example-kitchen-sink dev`  (predev brings up Docker infra + schema, then `next dev`)

## Risks to verify during build

- **MinIO CORS** for the browser presigned PUT carrying `x-amz-meta-*` (preflight).
  Mitigation: `MINIO_API_CORS_ALLOW_ORIGIN=*`. Verify the actual PUT succeeds from the
  browser; adjust if a stricter CORS config is needed.
- **Public render**: confirm `mc anonymous set download` makes path-style object URLs
  GET-able anonymously so `<img>` loads (canned `public-read` ACL is unreliable on
  MinIO — rely on the bucket policy instead).
- **`forcePathStyle`** must be set or the SDK builds virtual-host URLs MinIO can't serve.

## Verification (before done)

Drive the real browser (Claude-in-Chrome): pick an image as `user-a`, upload, watch
progress reach 100%, see the rendered image and `serverData`, and the new gallery row
(image + caption + scope). Switch to `user-b`: gallery shows a different set. Run the
hijack panel: complete-as-B fails, complete-as-A succeeds. Confirm the persisted row in
Postgres (`psql`/Prisma) including `scope` and `caption`.

## Out of scope

- Real authentication (identity is a header value only).
- Production hardening, multi-file batches beyond the demo, deletion/cleanup UI.
- Any change to `@upload-stuff/core`, `@upload-stuff/server`, or the adapters.
