---
"@upload-stuff/core": minor
"@upload-stuff/server": minor
"@upload-stuff/client": patch
---

Decouple ownership/auth and storage from the core, and make persisted file data customizable.

**Breaking** — the public API changes across core and server:

- **Ownership is now an opaque `scope`.** The `uploadedBy` column and the `ctx.userId` requirement are gone. Add a `scope` column to your `File` table and set ownership per route with `.scope(({ ctx }) => ctx.userId)`. Completion is filtered by the scope re-derived from the live `ctx`, so only the original owner can finalize a batch (an absent scope means an anonymous batch). Derive scope from `ctx` only, never from `input`.
- **Custom persisted columns** replace the built-in `entityId`. Declare them centrally on `UploadStuff({ fields: { … } })` (typed end-to-end) and set values per route with `.fields()`. The library ships no domain columns.
- **`UploadStuff` is curried:** `UploadStuff<Ctx>()({ … })` — the type argument fixes the file-usage-context union, the call infers the `fields` declaration.
- **Storage object metadata moved to the storage adapter.** The core no longer writes S3 metadata; pass `s3Adapter({ objectMetadata })` to opt in (defaults to none).
- **`ctx` is fully user-defined** — `ValidContextObject` no longer requires `userId`.
- **`DatabaseAdapter`** renames `findFilesByBatchIdAndUploadedBy` → `findFilesByBatchIdAndScope`, and the `uploadedBy` param on it and on `updateFilesToStored` → `scope`. The `.metadata()` route-builder step is removed in favour of `.scope()` and `.fields()`.
