---
"@upload-stuff/server": minor
"@upload-stuff/client": minor
"@upload-stuff/core": minor
---

Framework-agnostic handlers; hono removed from both server and client.

New: `toFetchHandler` (`@upload-stuff/server`) serves any fetch runtime (Bun, Deno, Workers, Hono); `toNodeHandler` (`@upload-stuff/server/node`) serves Express, NestJS and raw `node:http`. `toNextJsHandler` is unchanged (now wraps `toFetchHandler`; `config` is optional). Wire request/response types live in `@upload-stuff/core`.

Breaking:
- `UploadStuffHTTPServerType` is removed (was only needed by the old hono client).
- Handled error bodies normalize to `{ "error": string }` JSON (previously a mix of text and zod payloads).
- Client errors from non-OK responses now use the server's error text as `message` and carry `status`/`data` properties (previously a hono `DetailedError` with the bare status as message).
- Endpoint path segments are percent-encoded by the client and safe-decoded by the server.
- Aborting mid-`init-upload` now cancels the in-flight request; the rejection message is always `"Upload aborted."`.
