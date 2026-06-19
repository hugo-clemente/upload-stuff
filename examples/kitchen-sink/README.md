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
- Ownership via `.scope()`: a per-user scoped gallery, so each user only sees the
  files they uploaded.

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

`dev` runs `predev` automatically: it brings up Docker (Postgres + MinIO + a one-shot
`mc` that creates the public `uploads` bucket), then runs `prisma db push` and
`prisma generate`. Then open http://localhost:3000.

MinIO console: http://localhost:9001 (`minioadmin` / `minioadmin`). Postgres is
published on host port `5433` (see `.env`), so it won't collide with a Postgres you may
already run on the default `5432`.

To stop the infra: `cd examples/kitchen-sink && docker compose down` (add `-v` to wipe
the data volumes).

## Notes

- Credentials here are throwaway local defaults — no real auth, no secrets.
- The `File` schema is created with `prisma db push` (no migrations folder).
- **`.scope()` is not authentication.** It enforces ownership *given a trustworthy
  identity*. Here the identity is an unauthenticated `x-user-id` header chosen in the
  UI — fine for a demo, but in a real app derive `ctx` from a verified session.
- **Public objects are world-readable.** The route is `isPublic: true` and the bucket
  has anonymous-download, so anyone with an object's `http://localhost:9000/uploads/<key>`
  URL can read it. `.scope()` guards listing/finalization, not raw object reads. Use
  `isPublic: false` (and a signed-read flow) for private files.
- On a first cold boot, the `uploads` bucket is created by a one-shot `mc` container in
  the background; if your very first upload races it, wait for `minio ready` in the
  compose logs and retry.
