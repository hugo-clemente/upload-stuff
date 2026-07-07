<!--
  DRAFT — at docs go-live, replace README.md with this file's contents and
  substitute <DOCS_URL> with the live docs domain. Kept as a draft (not applied)
  so the published README never links to a dead URL before the site is up.
-->

# upload-stuff

A typed file-upload library built on presigned S3 uploads, a typed
HTTP wire contract, and React hooks. Define a file router on the
server, wire it into your Next.js App Router (or any fetch-compatible runtime),
and call `useUploadStuff` from the client.

**📖 Full documentation: <DOCS_URL>**

## Install

```sh
# Backend
pnpm add @upload-stuff/server

# Frontend
pnpm add @upload-stuff/client
```

`@upload-stuff/core` comes transitively. All packages are ESM-only.

## Minimal example

```ts
// Define a typed file router on the server
const f = createUploadStuffRouter<Context, typeof uploadStuff>();

export const fileRouter = {
  avatar: f({ files: ["image/*"], maxFileSize: "4MB" })
    .middleware(({ ctx }) => ({ userId: ctx.userId }))
    .onUploadComplete(({ files, middlewareData }) => {
      console.log("Uploaded by", middlewareData.userId, files);
    })
    .build(),
};

export type FileRouter = typeof fileRouter;
```

```tsx
// The client hook infers its types from the router
const { startUpload, isUploading, accept } = useUploadStuff((r) => r.avatar, {
  onClientUploadComplete: (res) => console.log(res.files),
});
```

See the **[quickstart](<DOCS_URL>/docs/quickstart)** for the full Next.js setup,
the **[S3 and Prisma adapters](<DOCS_URL>/docs/concepts)**, and the
**[API reference](<DOCS_URL>/docs/api)**.

## License

MIT
