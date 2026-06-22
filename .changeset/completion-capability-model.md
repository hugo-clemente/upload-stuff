---
"@upload-stuff/core": minor
"@upload-stuff/server": minor
"@upload-stuff/client": minor
---

Capability-based completion replaces identity-based `.scope()`.

- **`.scope()` removed.** Completion is now guarded by a per-batch secret token. Init returns `batchToken` (renamed from `batchId`); the DB stores/queries `sha256(token)` as the `batchId` column. The client replays `batchToken` to complete.
- **`onUploadComplete` no longer receives `ctx`** — it runs on stored `input`/`middlewareData`/`files` only.
- **New `uploadWindowSeconds`** (default `3600`, range `1..604800`): drives the presign expiry, the completion deadline, and the abandoned-row cleanup threshold.

**BREAKING:**
- Remove `.scope(...)` from routes. For per-user listing, declare an owner field, set it from `ctx` in `.fields()`, and filter your own queries by it.
- `onUploadComplete` callbacks lose the `ctx` argument; move identity use into `.middleware()`.
- The init result / complete payload field is `batchToken`, not `batchId`. Treat it as a secret (body-only, never logged).
- Custom `DatabaseAdapter`: rename `findFilesByBatchIdAndScope` → `findFilesByBatchId`, drop `scope` from `updateFilesToStored`, and expose `createdAt` on returned rows. The stored/queried `batchId` is the library-supplied `sha256(token)`.
- Custom `StorageAdapter`: `generatePresignedUpload` receives `expiresInSeconds` and must sign to it; `scope` is gone from the object-metadata input.
- Drop the `scope` column from your schema; add your own metadata column(s) if needed.
- `serverUtils.cleanUpFiles` now reaps abandoned pending rows older than `uploadWindowSeconds` (default 1h) instead of a hardcoded 24h.
