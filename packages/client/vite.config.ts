import { defineConfig } from "vite-plus";

export default defineConfig({
  // Library build, migrated from tsup.config.ts. `vp pack` (tsdown) replaces tsup.
  pack: {
    entry: {
      index: "src/index.ts",
    },
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    // Emit .js/.d.ts (not .mjs/.d.mts) to match the package.json `exports`.
    fixedExtension: false,
  },
  // Migrated from the former vitest.config.ts; matches core/server.
  test: {
    typecheck: { enabled: true, tsconfig: "./tsconfig.json" },
  },
});
