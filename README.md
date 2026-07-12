<!-- Replace <DOCS_URL> with the live docs domain at go-live. -->

# upload-stuff

A typed file-upload library built on presigned S3 uploads. Define a file router
on the server, wire it into your Next.js App Router (or any fetch-compatible
runtime), and call `useUploadStuff` from the client.

**📖 Full documentation: <DOCS_URL>**

## Packages

| Package                | Description                                                               |
| ---------------------- | ------------------------------------------------------------------------- |
| `@upload-stuff/server` | Server runtime, fetch/Node/Next.js handlers, S3 and Prisma adapters       |
| `@upload-stuff/client` | Framework-free upload engine (validation, presigned PUT, progress, abort) |
| `@upload-stuff/react`  | React hooks over the engine                                               |
| `@upload-stuff/core`   | Isomorphic types, Zod schemas, errors and utils (comes transitively)      |

All packages are ESM-only.

## Install

```sh
pnpm add @upload-stuff/server @upload-stuff/client @upload-stuff/react
```

## Minimal example

Define a typed file router on the server:

```ts
const f = createUploadStuffRouter<typeof uploadStuff, Context>();

export const fileRouter = {
  avatar: f({ isPublic: true, files: ["image/*"], maxFileSize: "4MB" })
    .middleware(({ ctx }) => ({ userId: ctx.userId }))
    .onUploadComplete(({ files, middlewareData }) => {
      console.log("Uploaded by", middlewareData.userId, files);
    })
    .build(),
};

export type FileRouter = typeof fileRouter;
```

The client hook infers its types from the router:

```tsx
const { startUpload, isUploading, accept } = useUploadStuff((r) => r.avatar, {
  onClientUploadComplete: (res) => console.log(res.files),
});
```

See the **[quickstart](<DOCS_URL>/docs/quickstart)** for the full Next.js setup,
the **[S3](<DOCS_URL>/docs/adapters/s3)** and
**[Prisma](<DOCS_URL>/docs/adapters/prisma)** adapters, and the
**[API reference](<DOCS_URL>/docs/reference/server)**.

## License

MIT
