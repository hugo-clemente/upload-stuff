import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
    },
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    // Hooks package: every chunk must open with the RSC client directive.
    banner: { js: '"use client";' },
    // Emit .js/.d.ts (not .mjs/.d.mts) to match the package.json `exports`.
    fixedExtension: false,
  },
  test: {
    // @testing-library/react needs a DOM.
    environment: "jsdom",
    typecheck: { enabled: true, tsconfig: "./tsconfig.json" },
  },
});
