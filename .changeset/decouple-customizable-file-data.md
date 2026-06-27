---
"@upload-stuff/core": minor
"@upload-stuff/server": minor
"@upload-stuff/client": patch
---

Decouple ownership/auth and storage from the core, and make persisted file data customizable.

**Breaking** — the public API changes across core and server:

- **Ownership/auth is decoupled from the core.** The `uploadedBy` column and the `ctx.userId` requirement are gone — the library ships no built-in identity. How batch completion is authorized is covered by the capability-token change in this release.
- **Custom persisted columns** replace the built-in `entityId`. Declare them centrally on `UploadStuff({ fields: { … } })` (typed end-to-end) and set values per route with `.fields()`. The library ships no domain columns.
- **`UploadStuff` is curried:** `UploadStuff<Ctx>()({ … })` — the type argument fixes the file-usage-context union, the call infers the `fields` declaration.
- **Object-storage metadata is resolved by a typed resolver on the storage adapter,** typed against your `fields` declaration (defaults to none). The core no longer hardcodes S3 metadata.
- **`ctx` is fully user-defined** — `ValidContextObject` no longer requires `userId`.
- **The `.metadata()` route-builder step is removed in favour of `.fields()`.** `DatabaseAdapter` and `DatabaseFile` now carry the declared `fields` as a second type parameter, so a custom adapter's persistence contract includes the required custom columns. (The `DatabaseAdapter` method/param changes on the completion path are covered by the capability-token change.)

The custom-fields feature is now safe and typed end-to-end:

- **Reserved column names are rejected.** Declaring a custom field that reuses a library-owned column (`stored`, `batchId`, `id`, …) is a type error and throws at `UploadStuff()` init, so a field value can never overwrite the library's own state.
- **`.fields()` output is filtered to declared keys** before it reaches the row, so a stray/typo key can't be persisted as an unknown column.
- **`.fields()` is mandatory at the type level when a declared field is `required: true`** — omitting it is a build-time error instead of a later NOT NULL violation.
- **Object metadata is signed safely.** `generatePresignedUpload` now returns the headers the client must replay (e.g. `x-amz-meta-*`) and the React client sends them on the PUT, so presigned uploads with a non-empty `objectMetadata` no longer fail S3's signature check. The direct `serverUtils.uploadFile` path now also resolves and writes `objectMetadata`, matching the presigned flow, and its `data` type includes the declared custom fields.
- **Interface-shaped contexts are accepted** — `ValidContextObject` is `object`, so `interface AppContext { … }` satisfies the fully-user-defined context API (a `Record<string, unknown>` constraint rejected interfaces).
