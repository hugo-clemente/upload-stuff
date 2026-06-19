---
"@upload-stuff/core": minor
"@upload-stuff/server": minor
---

Adapters are now supplied to `UploadStuff(...)` as factories, and object metadata moves onto the storage adapter.

- **Adapter factories, inferred types.** `databaseAdapter` and `storageAdapter` now take a factory (`DatabaseAdapterFactory` / `StorageAdapterFactory`) that the library calls once with the instance's resolved types. `prismaAdapter(...)` and `s3Adapter(...)` return these factories, so `TFileUsageContext` and `fields` are inferred end-to-end — you no longer pass adapter generics by hand (`prismaAdapter<"avatar", typeof fields>(...)` becomes `prismaAdapter(...)`).
- **`objectMetadata` moved to the storage adapter.** It was a top-level option on `UploadStuff({ objectMetadata })`; it now lives on `s3Adapter({ objectMetadata })` (still typed against your `fields`, by inference). The core no longer pre-resolves it — the storage adapter resolves it from the raw row.

**BREAKING:**
- Move your `objectMetadata` resolver from the `UploadStuff(...)` config into the `s3Adapter(...)` config.
- A custom `DatabaseAdapter` passed as a plain object must now be supplied as a factory: `databaseAdapter: () => myAdapter` (or typed as `DatabaseAdapterFactory`).
- `StorageObjectInfo` (the storage-adapter method input) changed: the pre-resolved `objectMetadata` field is replaced by the raw `filename`, `scope`, and `fields` so adapters resolve metadata themselves.
