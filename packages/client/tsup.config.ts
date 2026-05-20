import { execFileSync } from "node:child_process";

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
  // Async fn (not a string): tsup awaits it, so the build only finishes once
  // `tsc` has. `execFileSync` throws on a non-zero exit, failing the build.
  onSuccess: async () => {
    execFileSync("tsc", ["-p", "tsconfig.build.json"], { stdio: "inherit" });
  },
});
