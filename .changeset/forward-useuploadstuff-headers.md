---
"@upload-stuff/client": patch
---

`useUploadStuff` now forwards its `headers` option (and `startUpload`'s per-call
`headers`) to the init-upload and complete-upload requests, so consumers can attach
auth/identity headers to the upload lifecycle.
