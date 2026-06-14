---
date: 2026-06-14
topic: docs-site
title: Documentation site (Fumadocs) as adoption surface for npm launch
---

# Documentation site (Fumadocs) as adoption surface

## Summary

Build a public Fumadocs documentation site in `apps/docs` of this monorepo as
the adoption surface for the upcoming `@upload-stuff/*` npm launch. v1 ships a
landing page, a 5-minute quickstart, core concepts, task guides, recipes, a
"why upload-stuff" comparison, and an auto-generated API reference. Because the
site imports the real workspace packages, API tables and code samples are
type-correct against workspace source by construction. (This tracks workspace
source, not the published artifact — see Dependencies for the published-install
gap.)

## Problem Frame

The library is feature-complete enough to publish (v0.0.0, unpublished) but has
only a single ~340-line `README.md`. That README is a competent reference for
someone who already decided to use the library, but it's the wrong shape for the
moment that matters at launch: a developer evaluating whether to adopt
`upload-stuff` over UploadThing or rolling their own presigned-S3 flow. There's
no landing page, no first-five-minutes path, no navigable concept/guide
separation, and no positioning. A long README also can't carry the conceptual
and recipe content that an adoption decision needs without becoming unreadable.

The library is also heavily typed (a Hono RPC layer, a typed file-router
builder, Standard Schema inputs). Hand-written API docs and code samples for a
library like this drift the moment a signature changes — and stale examples on
an adoption surface actively cost trust.

## Key Decisions

- **Fumadocs over Mintlify (and other tools).** Next.js App Router native, which
  matches the library's primary integration target; MDX; built-in search; free;
  full ownership of output. Rejected hosted SaaS (Mintlify) to avoid vendor
  lock-in and keep the docs on the same stack as the library. The accepted cost
  is that setup, theming, and deploy are the maintainer's responsibility.

- **Site lives in `apps/docs` inside this monorepo.** Lets the docs app import
  the real `@upload-stuff/*` packages via the workspace protocol, so the API
  reference and code samples reference the actual types. Rejected a separate repo
  because it would reintroduce the drift problem. The accepted cost is a docs app
  added to the repo, CI, and deploy.

- **API correctness is mechanized, not maintained by hand.** API reference tables
  are generated from the real type sources (`AutoTypeTable` / `fumadocs-typescript`),
  and code samples are Twoslash-typechecked against the current packages. Drift
  becomes a build failure rather than a thing to remember. This guards drift from
  workspace source only; the published-install surface (including optional peers
  like the AWS SDK for the S3 adapter) is validated at publish time, not by
  Twoslash.

- **README becomes an entry point, not a competitor.** After launch the README
  is slimmed to a short install + minimal example that points to the docs site as
  the canonical reference. It is not deleted and not duplicated wholesale.

- **All four content areas ship in v1, with a defined slip order.** If launch
  timing tightens, the launch-blocking set is the evaluator path and trust
  mechanism — the landing page (R4), quickstart (R5), core concepts (R6), the
  "why" page (R9), and the auto-generated reference plus Twoslash correctness
  (R10, R11) — together with the launch wiring (R12, R13). The task guides (R7)
  and recipes (R8) are launch-supporting and may follow as fast-follow without
  blocking the publish.

## Requirements

**Site and infrastructure**

- R1. The docs site is a Fumadocs (Next.js App Router) application at `apps/docs`.
- R2. The pnpm workspace is extended to include `apps/*`, and `apps/docs` depends
  on the `@upload-stuff/*` packages via the workspace protocol so it imports real
  types at build time.
- R3. The site is a standalone public deployment with Fumadocs' built-in search
  enabled.

**Content (v1)**

- R4. A landing page carrying the value proposition, a short "why upload-stuff"
  pitch, a code peek, and primary calls to action (quickstart, install).
- R5. A quickstart that takes a reader with the stated prerequisites — a Next.js
  app and an S3 bucket with CORS and credentials configured — to a working upload
  in roughly five minutes, following the page alone. The prerequisites are named
  up front, and the quickstart links out to AWS bucket/CORS setup rather than
  silently assuming it.
- R6. A core-concepts section covering the file router, the presigned-S3 upload
  flow, storage/database adapters, usage contexts, and the upload init/complete
  lifecycle.
- R7. Task guides for: the Next.js handler, the S3 adapter, the Prisma adapter
  and its required `File` model, implementing the `DatabaseAdapter` / storage-adapter interface for a custom backend,
  the client hooks, server utilities, and image compression.
- R8. A recipe gallery covering at least: avatar upload, document upload with
  `.input()`, the cleanup cron, and direct server-side upload.
- R9. A "why upload-stuff" page positioning the library against UploadThing and
  rolling-your-own. It states the bring-your-own-S3 trade-off honestly:
  UploadThing manages storage, while upload-stuff expects the adopter's own
  bucket and credentials.

**API reference and code correctness**

- R10. An auto-generated API reference produced from the real type sources via
  `AutoTypeTable`, covering at least `RouteConfig`, `DatabaseAdapter`, the storage
  adapter interface, `FileRoute`, the builder methods, and the hook return types.
- R11. Code samples across the site are Twoslash-typechecked so a sample that no
  longer matches the current API fails the docs build.

**Launch and README relationship**

- R12. Docs go-live is sequenced with the v0.x npm publish; install steps and the
  adoption framing assume the packages are published.
- R13. The `README.md` is slimmed to a short install + minimal example that links
  to the docs site as the canonical reference.

## Key Flows

- F1. Evaluator first run
  - **Trigger:** A developer comparing upload solutions lands on the docs site.
  - **Steps:** Landing page communicates the value prop and "why" → reader clicks
    into the quickstart → follows it end-to-end → has a working Next.js upload
    without reading library source.
  - **Outcome:** The reader can decide to adopt based on the docs alone.
  - **Non-Next.js evaluators:** the v1 quickstart targets Next.js App Router; the
    landing page states the library is fetch-compatible and that other-runtime
    guides are deferred, so a Remix / SvelteKit / Hono evaluator can decide
    rather than abandon at a Next-only quickstart.
  - **Covers:** R4, R5, R9.

## Acceptance Examples

- AE1. **Covers R5.** Given a developer who has completed the stated
  prerequisites (a Next.js app and an S3 bucket with CORS and credentials
  configured), when they follow only the quickstart, then they reach a working
  upload without opening `packages/` source.
- AE2. **Covers R11.** Given a code sample that references a renamed or removed
  export, when the docs build runs, then the build fails on the Twoslash check.
- AE3. **Covers R10.** Given a field is added to `RouteConfig` in
  `packages/core/src`, when the docs are rebuilt, then the API reference table
  reflects the new field with no manual edit.

## Success Criteria

- An evaluator who meets the quickstart's stated prerequisites gets from the
  landing page to a working upload via the quickstart alone, without reading
  library source. ("Typechecks" via Twoslash and "produces a working upload" are
  separate guarantees — the latter is validated at runtime, not by the type
  checker.)
- Every code sample typechecks against the current packages. The API reference is
  generated from types wherever AutoTypeTable can render them; any types it cannot
  render fall back to a named, minimal set of hand-authored tables — the only
  drift-prone surface.
- The docs site is the canonical reference and the README defers to it.

## Scope Boundaries

**Deferred for later**

- Docs versioning / per-release documentation — v1 is a single current version.
- Guides for non-Next.js runtimes — the library supports any fetch-compatible
  runtime, but v1 leads with Next.js.
- Internationalization.

**Outside this product's identity**

- Hosted SaaS docs (Mintlify and similar) — ownership and stack fit were the
  deciding factors.
- Maintained documentation for many specific third-party database/storage
  backends — the library ships one reference adapter (Prisma) and documents the
  `DatabaseAdapter` / storage interface itself (R7) so users build their own; it
  does not maintain a catalog of backend-specific adapter guides.

## Dependencies / Assumptions

- Docs go-live is sequenced with the v0.x npm publish (R12) via a staged publish:
  cut a prerelease / dist-tag, validate `npm install @upload-stuff/*` and the
  quickstart against the real registry, then flip docs go-live. Sequenced
  together but decoupled enough that a slip in one need not block the other.
- Deploy target is assumed to be Vercel; a domain is needed and not yet chosen.
- Requires adding `apps/*` to `pnpm-workspace.yaml` (currently `packages/*` only).
- `AutoTypeTable` on a serverless deploy needs the `fumadocs-typescript`
  filesystem generator cache configured.
- Framework is Fumadocs on Next.js App Router.

## Outstanding Questions

**Deferred to planning**

- Domain name and hosting specifics.
- Navigation / information architecture and how much theming and branding v1
  invests in beyond the Fumadocs default.
- Spike `AutoTypeTable` against the builder methods and hook return types in
  `packages/core/src/router-types.ts` before committing the full API-reference
  scope. For any type it cannot render cleanly, pick the fallback explicitly: a
  hand-authored table (the accepted drift-prone exception), omit it from the
  reference, or simplify the public type.
- Whether the "why upload-stuff" page names competitors directly or stays
  neutral.

## Sources / Research

- `README.md` — current usage content to migrate and expand into guides.
- `packages/core/src` (`router-types.ts`, `types.ts`, `schemas.ts`),
  `packages/server/src/adapters` — the type sources `AutoTypeTable` reads for the
  API reference.
- Fumadocs documentation (Context7 `/fuma-nama/fumadocs`): `AutoTypeTable` via
  `fumadocs-typescript`, Twoslash type-checked code samples, the `apps/docs`
  monorepo pattern, and built-in search.

## Deferred / Open Questions

### From 2026-06-14 review

- Content-intent for the by-name v1 content areas, so planning doesn't default to
  generic output: what the landing code peek (R4) must demonstrate (the typed
  router → inferred client-type differentiator), the recipe-gallery (R8)
  discovery format (curated prose index vs cards carrying adapters/complexity),
  the comparison-page (R9) format (side-by-side code vs feature table vs prose),
  and the navigation grouping (comparison-page placement; guides vs recipes
  co-located or separate). (design-lens)
- Orphaned content items: the image-compression task guide (R7) and the
  cleanup-cron recipe (R8) have no backing core concept (R6) or evaluator-flow
  home. Decide per item: promote to a core concept, keep as post-adoption
  (existing-user) content outside the evaluator path, or defer past v1.
  (scope-guardian)
