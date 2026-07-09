---
"@upload-stuff/server": patch
---

`@upload-stuff/server` now exports an explicit `ServerUtils<TFields>` type used
for `uploadStuff.serverUtils`, replacing an internal `ReturnType<typeof …>`
inference that crashed TypeScript's quick-info (stack overflow) when
`UploadStuff` types were hovered from another module. Structurally identical;
no behavior change.
