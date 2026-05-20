import { execFileSync } from "node:child_process";

import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    next: "src/next/index.ts",
    "adapters/s3": "src/adapters/s3.ts",
    "adapters/prisma": "src/adapters/prisma.ts",
  },
  format: ["esm"],
  // Declarations are emitted by `tsc` (see onSuccess), not tsup's bundlers.
  // tsup's dts paths (rollup-plugin-dts and experimentalDts) both emit before
  // the type checker is warmed, which re-instantiates the deep Hono RPC chain
  // in src/next and fails with TS2589. `tsc` checks-then-emits, so it succeeds.
  dts: false,
  clean: true,
  sourcemap: true,
  // Async fn (not a string): tsup awaits it, so the build only finishes once
  // `tsc` has. `execFileSync` throws on a non-zero exit, failing the build.
  onSuccess: async () => {
    execFileSync("tsc", ["-p", "tsconfig.build.json"], { stdio: "inherit" });
  },
});
