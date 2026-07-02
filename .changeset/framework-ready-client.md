---
"@upload-stuff/client": major
"@upload-stuff/react": major
---

Split the React bindings out of `@upload-stuff/client` into the new `@upload-stuff/react` package. `@upload-stuff/client` is now a framework-free upload engine (`createUploadStuffClient` → `{ fetchRouteConfig, uploadFiles }`) — the boundary future Vue/Svelte bindings will build on.

**Migration** — install `@upload-stuff/react`, then update your setup file:

```ts
// before
import { createUploadStuffReactHelpers } from "@upload-stuff/client";
export const { useUploadStuff } = createUploadStuffReactHelpers<FileRouter>({ baseURL });

// after
import { createUploadStuffClient } from "@upload-stuff/client";
import { createUploadStuffReactHelpers } from "@upload-stuff/react";
const client = createUploadStuffClient<FileRouter>({ baseURL });
export const { useUploadStuff } = createUploadStuffReactHelpers(client);
```

Component code is unchanged: `useUploadStuff` / `useRouteConfig` keep their signatures.

Also in this release:

- `startUpload` (and the engine's `uploadFiles`) now resolve with the verified `CompleteUploadResult` instead of `void`.
- Route config is fetched on demand — `startUpload` no longer throws "Route config not loaded yet" when called before the config loads.
- Calling with an empty `files` array now rejects with "No files provided." (was a silent no-op).
- The hook-level `signal` option was removed — it was never wired. Pass a signal per call: `startUpload(files, input, { signal })`.
- New engine exports: `mergeHeaders`, `getAcceptFromType`, `resolveEndpoint`, plus the core types used in public signatures.
