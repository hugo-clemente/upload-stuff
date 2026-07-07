---
"@upload-stuff/core": minor
"@upload-stuff/server": minor
"@upload-stuff/client": minor
"@upload-stuff/react": minor
---

BREAKING: removed the file usage context.

- `usageContext` is removed from route config (`f({ ... })` no longer takes it).
- The `TFileUsageContext` generic and the `fileUsageContext` / `__fileUsageContext`
  markers are removed from all public types.
- `UploadStuff` is now a single-call factory: `UploadStuff({ ...config })` instead
  of `UploadStuff<Union>()({ ...config })`.
- `GET /route-config` responses no longer include `usageContext`.
- `DatabaseFile`, the storage/database adapter APIs, object metadata, and the
  file id/key generator params no longer include `usageContext`.

Migration: drop the built-in `usageContext` column from your persisted schema. If
you need a file category, model it as a declared custom `fields` column.
