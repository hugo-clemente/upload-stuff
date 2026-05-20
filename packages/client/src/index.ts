// The "use client" directive is injected into every output chunk by tsup's
// `banner` (see tsup.config.ts) — esbuild does not preserve a source-level one.
export * from "./impl";
