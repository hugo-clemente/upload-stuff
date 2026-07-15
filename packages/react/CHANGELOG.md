# @upload-stuff/react

## 0.2.0

### Minor Changes

- 39ca2da: First supported release — start here.

  The `0.1.0` builds of `@upload-stuff/core`, `@upload-stuff/server`, and
  `@upload-stuff/client` on npm are stale artifacts published before the current
  API (per-type `files` route config, framework-agnostic handlers) and are
  deprecated. `0.2.0` is the first release matching the documented API; see the
  `0.1.0` changelog entry below for the full feature set.

## 0.1.0

### Minor Changes

- a1553e4: First public release.

  Type-safe file uploads for TypeScript apps:

  - `@upload-stuff/server` — define upload routes with per-MIME-type constraints, middleware, and custom fields; S3-compatible storage adapter; handlers for any fetch runtime (`toFetchHandler`), Node (`toNodeHandler`), and Next.js (`toNextJsHandler`).
  - `@upload-stuff/client` — framework-agnostic upload client validating against the server's route config.
  - `@upload-stuff/react` — React bindings and hooks.
  - `@upload-stuff/core` — shared types and wire contracts.
