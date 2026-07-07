---
"@upload-stuff/core": minor
"@upload-stuff/server": minor
"@upload-stuff/client": minor
"@upload-stuff/react": minor
---

BREAKING: route config `type` has been replaced by a per-type `files` map.

- `files` accepts generated MIME literals, generated `type/*` wildcards, `blob` as the only non-MIME keyword, and `customMime(...)` for unregistered MIME values. Written directly as an array (`files: ["image/*"]`) or a per-type record (`files: { "image/*": { maxFileSize: "8MB" }, "application/pdf": {} }`).
- Matching precedence is exact `type/subtype` > `type/*` wildcard > `blob`, with strict `type/subtype` syntax required for exact/wildcard eligibility. Per-entry limits apply to the winning bucket only.
- File sizes resolve through `entry.maxFileSize ?? route.maxFileSize ?? defaultMaxFileSize`; the instance default is `"4MB"`. Batch count resolves through `route.maxFileCount ?? defaultMaxFileCount`; the instance default is `20`.
- `route-config` now returns the normalized config; the client validates against exactly what the server enforces. Content types are matched on their canonical (un-folded) value and folded to a storage-safe value at the persistence/signing boundary, so malformed/untyped uploads match `blob` only, never a typed wildcard, and the DB row + signed S3 `Content-Type` are always well-formed.
- `acceptedFileTypes`, `getValidMimeTypes`, and `AcceptedFileType` have been removed from `@upload-stuff/core`.
- `getAcceptFromType(routeConfig.type)` is removed from `@upload-stuff/client`; use `getAcceptFromRouteConfig(routeConfig)` (the `@upload-stuff/react` `accept` value already switches to it).
- `preprocessImages` only compresses `image/jpeg`, `image/png`, and `image/webp`, sized to the matched bucket.
- File validation now runs before `middleware` and `fields`, so a rejected batch no longer triggers middleware side effects. `middleware` and `fields` receive raw content types.
- Upgrade `@upload-stuff/server` and `@upload-stuff/client`/`@upload-stuff/react` together — the client expects the new normalized `route-config` payload and throws a clear version-skew error otherwise.
