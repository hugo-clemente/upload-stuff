---
"@upload-stuff/core": minor
"@upload-stuff/client": patch
"@upload-stuff/server": patch
---

Harden the upload flow and share validation helpers across client and server.

- **core:** export `DEFAULT_BASE_PATH` and `getValidMimeTypes`; `getFileSizeInBytes` now parses fractional sizes (e.g. `"1.5MB"`) and throws on malformed input instead of returning `NaN`; `validateFiles` rejects all files when `maxFileCount` is `0`; `onUploadComplete` now types `middlewareData` from the middleware output rather than the metadata.
- **client:** add a synchronous re-entrancy guard so a second `startUpload` in the same tick can't corrupt shared refs; stop double-reporting an aborted upload as both `onUploadAborted` and `onUploadError`/`onClientUploadComplete`.
- **server:** S3 `verifyUpload` now rethrows non-404 errors (throttling, credentials, 5xx) as retryable failures instead of reporting them as invalid uploads; the Prisma adapter deletes from storage before removing DB rows so a failed storage delete leaves no orphans; `serverUtils` deletes pass `throwIfError` so a partial storage failure aborts the DB deletion.
