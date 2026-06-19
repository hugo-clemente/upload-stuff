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
- **Object-storage metadata is resolved by a typed `objectMetadata` on `UploadStuff({ objectMetadata })`,** typed against your `fields` declaration; the storage adapter just writes the resolved map (defaults to none). The core no longer hardcodes S3 metadata.
- **`ctx` is fully user-defined** — `ValidContextObject` no longer requires `userId`.
- **`DatabaseAdapter`** renames `findFilesByBatchIdAndUploadedBy` → `findFilesByBatchIdAndScope`, and the `uploadedBy` param on it and on `updateFilesToStored` → `scope`. The `.metadata()` route-builder step is removed in favour of `.scope()` and `.fields()`. `DatabaseAdapter` and `DatabaseFile` now carry the declared `fields` as a second type parameter, so a custom adapter's persistence contract includes the required custom columns.

The custom-fields feature is now safe and typed end-to-end:

- **Reserved column names are rejected.** Declaring a custom field that reuses a library-owned column (`scope`, `stored`, `batchId`, `id`, …) is a type error and throws at `UploadStuff()` init, so a field value can never overwrite the library's own state.
- **`.fields()` output is filtered to declared keys** before it reaches the row, so a stray/typo key can't be persisted as an unknown column.
- **`.fields()` is mandatory at the type level when a declared field is `required: true`** — omitting it is a build-time error instead of a later NOT NULL violation.
- **Object metadata is signed safely.** `generatePresignedUpload` now returns the headers the client must replay (e.g. `x-amz-meta-*`) and the React client sends them on the PUT, so presigned uploads with a non-empty `objectMetadata` no longer fail S3's signature check. The direct `serverUtils.uploadFile` path now also resolves and writes `objectMetadata`, matching the presigned flow, and its `data` type includes the declared custom fields.
- **Interface-shaped contexts are accepted** — `ValidContextObject` is `object`, so `interface AppContext { … }` satisfies the fully-user-defined context API (a `Record<string, unknown>` constraint rejected interfaces).
