import Link from 'next/link';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';

const peek = `// Server — define a typed file router
export const fileRouter = {
  avatar: f({ type: "image", usageContext: "avatar", maxFileSize: "4MB" })
    .middleware(({ ctx }) => ({ userId: ctx.userId }))
    .onUploadComplete(({ files }) => ({ url: files[0].publicUrl }))
    .build(),
};

// Client — the hook's return type is inferred from the router.
// No type annotations, no drift.
const { startUpload, isUploading } = useUploadStuff((r) => r.avatar, {
  onClientUploadComplete: (res) => console.log(res.files),
});`;

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-16 md:py-24 lg:flex-row lg:items-center">
        <div className="flex flex-col gap-6 lg:w-1/2">
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
            Typed file uploads for React &amp; Next.js
          </h1>
          <p className="text-lg text-fd-muted-foreground">
            Presigned S3 uploads, a typed HTTP wire contract, and React hooks. Define
            a file router on the server &mdash; the client hook types itself from
            it.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/docs/quickstart"
              className="rounded-lg bg-fd-primary px-5 py-3 text-center font-medium text-fd-primary-foreground"
            >
              Get started
            </Link>
            <Link
              href="/docs"
              className="rounded-lg border px-5 py-3 text-center font-medium"
            >
              Read the docs
            </Link>
          </div>
          <code className="text-sm text-fd-muted-foreground">
            npm install @upload-stuff/server @upload-stuff/client
          </code>
        </div>
        <div className="min-w-0 lg:w-1/2">
          <DynamicCodeBlock lang="ts" code={peek} />
        </div>
      </section>
    </main>
  );
}
