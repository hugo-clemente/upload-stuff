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
