import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    impl: "src/impl.ts",
  },
  format: ["esm"],
  // Declarations are emitted by `tsc` (see onSuccess), not tsup. See the
  // comment in packages/server/tsup.config.ts for the rationale.
  dts: false,
  clean: true,
  sourcemap: true,
  banner: { js: '"use client";' },
  onSuccess: "tsc -p tsconfig.build.json",
});
