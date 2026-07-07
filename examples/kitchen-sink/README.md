# upload-stuff — kitchen sink example

A Next.js App Router app exercising the full `upload-stuff` API end to end against a
local MinIO (S3-compatible) and Postgres, using the shipped `s3Adapter` and
`prismaAdapter`. Pick an image, upload it, watch progress, see it rendered back and
its persisted DB row — plus a per-user gallery demonstrating the capability-based
completion model.

## What it demonstrates

- Single-call `UploadStuff({ ... })` with central typed `fields` (`caption`, `userId`)
  and the s3 adapter's typed `objectMetadata` resolver (`owner` + `caption` → S3 object
  metadata) — adapters are factories, so no adapter generics are passed by hand.
- A file route using `.input()`, `.fields()`, `.middleware()`, and `.onUploadComplete()`
  — `.scope()` is gone; completion is guarded by the per-batch `batchToken` secret.
- `uploadWindowSeconds: 3600` — the presign expiry, completion deadline, and
  abandoned-row cleanup threshold in one place.
- The Next.js handler with `createContext` reading the user id from an `x-user-id`
  header.
- The typed `useUploadStuff` hook: upload progress, the server `onUploadComplete`
  result, and the stored image.
- A per-user gallery filtered by the `userId` field — each user only sees the files
  they uploaded.

## Prerequisites

- Docker running (for Postgres + MinIO).
- pnpm + Node (repo toolchain).

## Run

From the repo root:

```sh
pnpm install
pnpm -F './packages/*' build                                # build the @upload-stuff/* packages the example consumes
pnpm -F @upload-stuff/example-kitchen-sink env:start        # start Postgres + MinIO, push schema, generate client
pnpm -F @upload-stuff/example-kitchen-sink dev              # run the app
```

The example consumes the `@upload-stuff/*` packages exactly as an npm consumer would —
from their built output — so build them first. `env:start` brings up Docker (Postgres +
MinIO + a one-shot `mc` that creates the public `uploads` bucket), then runs
`prisma db push` and `prisma generate`. `dev` then just runs `next dev` — open
http://localhost:3000.

MinIO console: http://localhost:9001 (`minioadmin` / `minioadmin`). Postgres is
published on host port `5433` (see `.env`), so it won't collide with a Postgres you may
already run on the default `5432`.

To stop the infra: `pnpm env:down`
(this keeps the data volumes; add `docker compose down -v` from `examples/kitchen-sink`
to also wipe them).

## Notes

- Credentials here are throwaway local defaults — no real auth, no secrets.
- The `File` schema is created with `prisma db push` (no migrations folder).
- **The `batchToken` is a bearer secret.** Init returns it once; the client replays
  it to complete. It is hashed at rest (the DB stores `sha256(token)`) and lives only
  in request/response bodies — never URLs or logs. Treat it like a password.
- **Completion is possession-based, not identity-based.** Whoever holds a batch's
  token can finalize it, within the `uploadWindowSeconds` window (1h here). After the
  window, or once finalized, the token is inert.
- **`userId`/`caption` are plain consumer columns** with no auth weight; the gallery
  filters by `userId`. Identity here is an unauthenticated `x-user-id` header — fine
  for a demo; derive `ctx` from a verified session in a real app.
- **Public objects are world-readable** (`isPublic: true` + anonymous-download bucket).
- On a first cold boot, the `uploads` bucket is created by a one-shot `mc` container in
  the background; if your very first upload races it, wait for `minio ready` in the
  compose logs and retry.
