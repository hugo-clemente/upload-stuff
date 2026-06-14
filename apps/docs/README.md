# @upload-stuff docs site

The public documentation site for `upload-stuff`, built with
[Fumadocs](https://fumadocs.dev) (Next.js App Router). It imports the real
`@upload-stuff/*` workspace packages so the API reference (`AutoTypeTable`) and
the code samples (Twoslash) stay type-correct against the shipped API.

## Develop

From the repo root:

```bash
pnpm install
pnpm --filter docs dev      # docs server only
# or: pnpm dev              # docs + library watch builds in parallel
```

Open http://localhost:3000. Content lives in `content/docs/`; the landing page is
`app/(home)/page.tsx`.

Because Twoslash type-checks samples against the built `dist`, run a library
build at least once before relying on samples (`pnpm dev` keeps them fresh):

```bash
pnpm -F './packages/*' build
```

## Deploy (Vercel)

The site is deployed independently of the library publish — a docs build never
blocks a package release (the root `build`/`release` scripts are scoped to
`packages/*`).

Vercel project settings:

- **Root Directory:** `apps/docs`
- **Include files outside the Root Directory in the Build Step:** **enabled** —
  required so the build can reach the workspace packages and `AutoTypeTable` can
  read `packages/*/src`.
- **Framework preset:** Next.js
- Install and build commands come from `vercel.json` (it builds the workspace
  packages first so `dist` types exist for Twoslash, then builds the docs).

## Go-live sequence (staged publish)

`AutoTypeTable` and Twoslash validate against workspace source/`dist`, not the
published npm artifact. Stage the launch so the real install path is verified
before evaluators hit it:

1. Publish a prerelease / `dist-tag` of `@upload-stuff/*`.
2. Validate `npm install @upload-stuff/server @upload-stuff/client` and the
   quickstart against the real registry.
3. Choose the docs domain and point Vercel at it.
4. Flip docs go-live.
5. Replace the repo root `README.md` with `README.slim-draft.md`, filling in the
   real `<DOCS_URL>` — do this only once the domain is live so the README never
   links to a dead URL.
