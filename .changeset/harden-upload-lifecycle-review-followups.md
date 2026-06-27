---
"@upload-stuff/core": minor
"@upload-stuff/server": patch
---

Harden the upload lifecycle (pre-landing review follow-ups).

- **`maxFileCount` now defaults to 20** when a route doesn't set one, so an unbounded `files[]` can't fan out into unbounded presign/verification work. Routes that need more set `maxFileCount` explicitly; an explicit `0` still rejects all.
- **Batch tokens use Web Crypto, not `node:crypto`.** Token generation and hashing now use `crypto.getRandomValues` / `crypto.subtle.digest`, so `@upload-stuff/server` imports and bundles on fetch-compatible runtimes (Cloudflare Workers, Next Edge, Deno, Bun) as advertised.
- **The library stamps `createdAt` at init** (on the rows passed to `createFiles`) instead of relying on a DB default, and completion now **fails closed** if a pending batch's age can't be determined — the upload window no longer silently disappears for an adapter that doesn't surface `createdAt`.
- **Completion no longer reports false success** when a batch's rows vanish (e.g. cleanup reaping an expired batch) between the read and the stored-update: it re-checks and rejects instead of returning a 200 for deleted files.
