---
title: "feat: Docs improvement — showcase end-to-end type safety"
date: 2026-06-14
type: feat
status: ready
origin: docs/brainstorms/2026-06-14-docs-site-requirements.md
deepened: 2026-06-14
---

# feat: Docs improvement — showcase end-to-end type safety

## Summary

The Fumadocs site (`apps/docs`) is live, but its strongest selling point — end-to-end
type safety — is currently **asserted in prose, not shown**. The only live Twoslash
block (`content/docs/index.mdx`) trivially hovers a Zod type and never demonstrates the
two inference flows that make the library worth choosing:

1. **Router-internal:** `.middleware()`'s return type flows, typed, into
   `.onUploadComplete()`'s `middlewareData`; `.input()`'s parsed output types the server
   callbacks.
2. **Server → client:** `onUploadComplete`'s return becomes the client's
   `onClientUploadComplete` `res.serverData`; the route key and input type are inferred
   on the client from `typeof fileRouter`.

This plan improves the existing pages and adds one dedicated **Type safety** page so the
library's central claim is *proven with verified, hover-annotated code* (Twoslash builds
fail on drift) and a couple of `@ts-expect-error` "this does not compile" demonstrations —
applying the concrete techniques the better-auth / UploadThing audit surfaced, while
keeping the docs tight (the user's explicit constraint: "don't be too long, find the
right balance").

This is content work in `apps/docs`. No library source changes.

---

## Problem Frame

**Who:** developers evaluating `upload-stuff` for the npm launch (the docs are the
adoption surface).

**Problem:** A typed-upload library's differentiator is that the server router definition
and the client hook can't drift — the types connect them. Today a reader has to *take our
word for it*. The audit's clearest lesson: best-in-class typed-library docs (UploadThing,
better-auth) make that connection **tangible** — a named "type bridge" file, inline
data-contract comments, `Go to Definition` framing, and `@ts-expect-error` proofs — rather
than claiming it in prose. We have Twoslash + AutoTypeTable already wired and a precisely
mapped type surface; we are not yet using them to *show* the payoff.

**Goal:** make end-to-end type safety the thing a reader *sees working* within the first
screens, in both directions (router-internal and server→client), without bloating the
docs or breaking the green build.

---

## Audit Findings (consolidated research)

From the external audit (`ce-web-researcher`) of https://www.better-auth.com/docs and
https://docs.uploadthing.com, the transferable, *concrete* techniques:

- **Type bridge file, taught early.** UploadThing's `src/utils/uploadthing.ts`
  (`generateUploadButton<OurFileRouter>()`) is the physical proof the types crossed the
  server/client boundary, and it's a first-class quickstart step. Our equivalent is
  `lib/upload-stuff-client.ts` (`createUploadStuffReactHelpers<FileRouter>`) — present in
  the quickstart but not *framed* as the bridge.
- **`export type Router = typeof router` as the teaching moment**, named so the user owns
  it (`FileRouter`, not `UploadStuffRouter`).
- **Inline comments teach environment + data contract**, e.g. UploadThing's
  `// Whatever is returned here is sent to the clientside onClientUploadComplete callback`.
- **Show type safety via IDE behavior:** UploadThing pitches `Go to Definition` on the
  route selector. Our `useUploadStuff((r) => r.avatar)` selector is exactly this shape.
- **`@ts-expect-error` as proof** (better-auth) — turn a compiler rejection into a demo.
- **Positioning is one sentence; the code is the proof.** Keep prose lean.
- **Both sites' weakness = our opening:** neither has a single "here's how the types flow
  end-to-end" payoff. A dedicated, verified Type-safety page is differentiated.

From the type-surface map (`ce-repo-research-analyst`) — the exact, citeable flows and
the compile-error demos to embed are captured per-unit below. Key enabler: **`declare
const` for adapters/context** lets us write *self-contained, fully type-checked* Twoslash
samples without constructing real S3/Prisma adapters (Twoslash only type-checks, never
runs).

---

## Key Technical Decisions

### KTD1. Verified showcase lives in self-contained samples; quickstart stays copy-paste-real

Twoslash requires every sample to fully type-check. Quickstart blocks are **full-file,
copy-paste-real** and reference project-local modules (`./prisma`, `@/lib/auth`,
`@/lib/upload-stuff`). Converting them to Twoslash would force replacing those with
`declare const` stubs — which *destroys* their copy-paste value (a reader would paste
`declare const prisma`). **Decision:** the heavy verified, hover-annotated demonstrations
live in the new **Type safety** page and the `why` tab as *self-contained* samples
(`declare const` adapters); the quickstart keeps real copy-paste blocks and gains only
**one** isolated verified hover plus teaching comments. This preserves both copy-paste
fidelity and the green build.

### KTD2. Use `declare const` to make showcase samples compile in isolation

```ts
// pattern (not literal final code):
declare const storageAdapter: StorageAdapter;
declare const databaseAdapter: DatabaseAdapter;
const uploadStuff = UploadStuff<"avatar" | "document">({
  storageAdapter, databaseAdapter,
  filePublicUrlGenerator: ({ key }) => `https://cdn.example.com/${key}`,
});
```
This yields real, fully-typed `uploadStuff` / `FileRouter` values for the inference chain
with zero runtime wiring. Exact import paths for `StorageAdapter` / `DatabaseAdapter` /
`createUploadStuffReactHelpers` must be confirmed against each package's public exports at
implementation time (execution detail — see Assumptions).

### KTD3. Showcase both inference directions explicitly, with `^?` hovers on the payoff line

- Router-internal: hover `middlewareData` inside `.onUploadComplete` → shows the exact
  middleware return shape.
- Server→client: hover `res.serverData` in `onClientUploadComplete` → shows the
  `onUploadComplete` return type, proving they're the same type.

### KTD4. Prove rejections with `@ts-expect-error`, fold the best 2–3 into the Type-safety page

Rather than a separate "Common mistakes" page (brevity constraint), embed the 2–3
highest-signal compile failures (missing `middlewareData` field, misspelled route key,
bad `usageContext`) as `@ts-expect-error` lines inside the Type-safety page. A standalone
gotchas page is deferred (see Scope Boundaries).

### KTD5. Keep the green build non-negotiable; verify with a negative control

Every new Twoslash block must compile (`pnpm --filter docs build` exit 0). Each
`@ts-expect-error` must actually error (Twoslash fails the build if an expected error is
absent). Verification per unit includes a negative control: deliberately break one hover /
remove one expected error, confirm the build fails, then revert.

---

## Assumptions (headless — user unavailable to confirm)

The user explicitly delegated autonomy ("I won't be here to answer your questions,
continue until satisfied"). Inferred bets made to proceed:

- **A1.** A dedicated `type-safety` page (not just inline sections) is the right weight for
  the user's emphasis on showcasing type safety "between the router and the frontend
  client, as well as with the router implementation." Kept to one tight page.
- **A2.** Brevity beats completeness where they conflict: no standalone gotchas page; the
  comparison page keeps its three tabs; prose is trimmed, not expanded.
- **A3.** Exact public import paths (`StorageAdapter`, `DatabaseAdapter`,
  `createUploadStuffReactHelpers`, `inferRouteServerData`) are resolvable from the packages'
  entry points; if a type isn't re-exported, the sample imports from the documented subpath
  or the showcase is adjusted to types that are exported. Resolved at implementation.
- **A4.** Sidebar order places `type-safety` right after `why` and before `quickstart`
  (claim → proof → do-it), updated in `content/docs/meta.json`.

---

## Scope Boundaries

**In scope:** content + Twoslash/AutoTypeTable changes within `apps/docs` —
`content/docs/{index,why,quickstart,concepts/index,type-safety}.mdx`, `content/docs/meta.json`,
and the landing `app/(home)/page.tsx` peek snippet.

**Out of scope / non-goals:**
- No `@upload-stuff/*` library source changes. (If a sample reveals a genuinely missing
  *type export* that blocks a high-value showcase, surface it — do not silently patch
  library source under a docs plan.)
- No new `$infer`-style API on the library (an audit idea, but that's a library change,
  not docs).

### Deferred to Follow-Up Work
- **Standalone "Common mistakes" / FAQ page** (UploadThing-style gotcha page). High value,
  but the brevity constraint says fold the top failures into the Type-safety page now and
  grow a dedicated page later if the surface justifies it.
- **U7 task guides / U8 recipes** from the original build plan (already deferred there).
- Converting the *entire* quickstart to Twoslash (rejected by KTD1).

---

## Implementation Units

### U1. New "Type safety" page — the verified end-to-end showcase

**Goal:** one tight page that *proves*, with self-contained verified Twoslash, both
inference directions, plus 2–3 `@ts-expect-error` rejection demos. This is the centerpiece
and directly answers the user's core ask.

**Dependencies:** none.

**Files:**
- `apps/docs/content/docs/type-safety.mdx` (new)
- `apps/docs/content/docs/meta.json` (add `"type-safety"` after `"why"`)

**Approach:**
- Open with one sentence: the server router definition and the client hook share one source
  of truth, so they cannot drift — then *show it*, don't argue it.
- **Sample A — router-internal flow** (self-contained, `declare const` adapters per KTD2):
  define `uploadStuff`, `f = createUploadStuffRouter<Context, typeof uploadStuff>()`, then a
  route `.input(z.object({ folderId: z.string() })).middleware(({ ctx }) => ({ uploadedBy: ctx.userId })).onUploadComplete(({ input, middlewareData }) => ({ ownerId: middlewareData.uploadedBy }))`.
  Place `//          ^?` on `middlewareData` → renders `{ uploadedBy: string }`, and on
  `input` → renders the parsed schema output. Inline comment on the `onUploadComplete`
  return: `// whatever you return here is sent to the client, typed`.
- **Sample B — server → client flow** (self-contained): from the same router build a
  `FileRouter` type, `createUploadStuffReactHelpers<FileRouter>()`, then
  `useUploadStuff((r) => r.avatar, { onClientUploadComplete: (res) => { /* ^? on res.serverData */ } })`.
  Hover `res.serverData` → renders the exact `onUploadComplete` return type, proving the
  round-trip. Note the `Go to Definition` affordance on the `(r) => r.avatar` selector in
  prose (audit lesson).
- **Rejections (`@ts-expect-error`, KTD4):**
  - `middlewareData.role` when middleware returned `{ uploadedBy }` → TS2339
    *Property 'role' does not exist on type '{ uploadedBy: string }'.*
  - `useUploadStuff((r) => r.avatr)` → TS2551 *…Did you mean 'avatar'?*
  - `usageContext: "avatr"` against the `"avatar" | "document"` union → TS2322.
- Respect the **type-correct builder order** (`.input().middleware().metadata().onUploadComplete().build()`);
  calling `.onUploadComplete` before `.middleware` types `middlewareData` as `UnsetMarker`
  — do not write samples in that order.
- Do **not** destructure `metadata` in `onUploadComplete` — it is not in the param type
  (`{ files, input, ctx, middlewareData }` only).

**Patterns to follow:** the existing `ts twoslash` + `//    ^?` block in `index.mdx:14-21`;
AutoTypeTable usage in `api/index.mdx` if a generated table helps anchor a section.

**Test scenarios:**
- `pnpm --filter docs build` exits 0 with the new page (all hovers resolve, all
  `@ts-expect-error` lines actually error).
- Negative control: temporarily change a `^?` expectation or delete one `@ts-expect-error`;
  confirm the build fails; revert.
- `pnpm run lint` (root, scoped) passes for the new file.
- Page appears in the sidebar in the intended position; internal links resolve.

**Verification:** the page renders both flows with live hover types and visible "this
fails" blocks; build green.

---

### U2. Upgrade the landing payoff (`index.mdx` + home peek) to show real inference

**Goal:** replace the trivial Zod-hover with a sample that hovers the *inferred client
payload* — the actual selling point — so the first screen pays off the type-safety claim.

**Dependencies:** U1 (reuse the verified sample shape / link target).

**Files:**
- `apps/docs/content/docs/index.mdx`
- `apps/docs/app/(home)/page.tsx` (the `peek` string — keep it illustrative; tighten to
  mirror the verified shape, no Twoslash on the landing component)

**Approach:** sharpen the one-sentence positioning; swap the `index.mdx` Twoslash block so
the `^?` lands on an inferred client value (e.g. `res.serverData` or the `useUploadStuff`
return) rather than a bare Zod object, with a link to the new Type-safety page. Keep it
short — one block, one payoff.

**Test scenarios:**
- Build exits 0; the new hover resolves to the inferred type.
- Negative control as in U1.
- Landing renders; `peek` snippet still reads cleanly (it is `DynamicCodeBlock`, not
  verified — keep it representative of the real API: no `metadata` in `onUploadComplete`).

**Verification:** first docs screen and landing both demonstrate inference, not a generic
Zod type.

---

### U3. Make the `why` comparison verifiable + tighten

**Goal:** the `upload-stuff` tab currently *claims* "files + middlewareData are fully typed"
in a plain `ts` comment. Convert that one tab to verified `twoslash` with a `^?` hover that
proves it; leave the UploadThing / raw-presigned tabs as illustrative (they reference other
APIs and must not be type-checked against our packages).

**Dependencies:** U1.

**Files:** `apps/docs/content/docs/why.mdx`

**Approach:** convert only the first tab to `ts twoslash` (self-contained via `declare
const`), hover `middlewareData`. Keep the prose trade-off section; trim any redundancy.
**Guard:** the UploadThing tab uses `{ metadata, file }` — that is UploadThing's API, not
ours; ensure no real (verified) upload-stuff sample ever adopts that shape.

**Test scenarios:**
- Build exits 0 (only the upload-stuff tab is `twoslash`; the other two stay plain `ts` and
  are not type-checked).
- Negative control on the converted tab.
- Tabs still render and switch.

**Verification:** the comparison's central "ours is typed" claim is now machine-verified.

---

### U4. Quickstart — type-bridge framing, data-contract comments, one verified hover

**Goal:** apply the audit's highest-value, low-risk lessons to the quickstart without
breaking copy-paste fidelity (KTD1).

**Dependencies:** U1 (link target).

**Files:** `apps/docs/content/docs/quickstart.mdx`

**Approach:**
- Frame `lib/upload-stuff-client.ts` (the `createUploadStuffReactHelpers<FileRouter>` step)
  explicitly as **the type bridge** with a one-line `<Callout>`: this file wires the
  server's router types to the client; everything typed in the client flows from here.
- Add inline data-contract / environment comments to the router and handler blocks
  (e.g. on `.onUploadComplete`'s body: `// runs on your server after the upload is verified`;
  on its return: `// sent to the client's onClientUploadComplete, typed`).
- Add **one** isolated, self-contained verified `twoslash` "payoff" block after the client
  step that hovers the inferred `res.serverData` / hook return, with a link to the
  Type-safety page for the full story. Keep the existing full-file blocks as plain
  copy-paste `ts`/`tsx`.
- Keep the avatar route input-less so `startUpload(Array.from(...))` (no input arg) stays
  the type-correct call shown.

**Test scenarios:**
- Build exits 0 (full-file blocks remain plain; only the one payoff block is `twoslash`).
- Negative control on the payoff block.
- Steps render in order; the new Callout and links resolve.

**Verification:** a reader following the quickstart sees *where* the type bridge is and
gets one verified inference payoff inline, without losing copy-paste-real files.

---

### U5. Back the `concepts` claims with a verified rejection + cross-links

**Goal:** `concepts/index.mdx` asserts "misspelling a usageContext is a compile error" and
"the client hook infers its types from this definition" with no code. Add one small
verified `@ts-expect-error` snippet for the `usageContext` claim and cross-link to the
Type-safety page; keep the page conceptual and short.

**Dependencies:** U1.

**Files:** `apps/docs/content/docs/concepts/index.mdx`

**Approach:** under "Usage contexts," add a compact `ts twoslash` block with
`// @ts-expect-error` on a misspelled `usageContext`, proving the TS2322. Add a one-line
link from the "file router … single source of truth" paragraph to the Type-safety page.
Trim prose if the addition lengthens the page noticeably.

**Test scenarios:**
- Build exits 0; the `@ts-expect-error` actually errors.
- Negative control: remove the misspelling so the expected error disappears; confirm build
  fails; revert.
- Page renders; cross-links resolve.

**Verification:** the page's two type-safety claims are now backed by code or a link to
proof.

---

## Risks & Mitigations

- **Twoslash drift breaks the build.** That's the feature (drift = red build), but a sample
  that can't be made to compile blocks the unit. *Mitigation:* `declare const` adapters
  (KTD2); confirm exact export paths early (A3); if a needed type isn't exported, narrow the
  sample to exported types rather than touching library source.
- **Over-documentation against the brevity constraint.** *Mitigation:* one new page, fold
  failures in rather than a gotchas page, trim prose as samples are added (KTD4, A2).
- **Copy-paste regression in quickstart.** *Mitigation:* KTD1 keeps full-file blocks real;
  only one isolated verified block is added.
- **`metadata` shape leak from the UploadThing tab.** *Mitigation:* explicit guard in U3 and
  U1; `onUploadComplete` param is `{ files, input, ctx, middlewareData }` only.

## Verification (whole plan)

- `pnpm --filter docs build` exits 0 after every unit (Twoslash + AutoTypeTable validate the
  showcase against the real packages).
- `pnpm run lint` (root, scoped to packages; docs has its own oxlint config) passes.
- Manual: each new/edited page renders, hovers show the intended types, `@ts-expect-error`
  blocks display the failure, sidebar order and links are correct.
- Negative-control pass per unit (break → red build → revert) to confirm the verification is
  real, not vacuous.

## Sources & Research

- External audit: better-auth docs (`/docs/concepts/typescript` `$Infer`,
  `/docs/plugins/organization` `@ts-expect-error`), UploadThing docs
  (`/getting-started/appdir` type-bridge, `/api-reference/react` Go-to-Definition,
  `/faq`). Via `ce-web-researcher`.
- Type surface map via `ce-repo-research-analyst`: `packages/core/src/router-types.ts`
  (builder generics, `inferRouteInput`/`inferRouteServerData`),
  `packages/server/src/router/builder.ts`, `packages/server/src/router/handler.ts`,
  `packages/client/src/impl.ts` (`useUploadStuff`, `EndpointArg`, `RouteRegistry`),
  `packages/core/src/{schemas,types}.ts`. Type tests:
  `packages/core/src/router-types.test-d.ts:32-48`.
- Origin: `docs/brainstorms/2026-06-14-docs-site-requirements.md`;
  build plan `docs/plans/2026-06-14-001-feat-docs-site-fumadocs-plan.md`.
