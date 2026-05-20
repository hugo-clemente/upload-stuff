import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    impl: "src/impl.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  banner: { js: '"use client";' },
});
