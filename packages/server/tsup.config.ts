import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    next: "src/next/index.ts",
    "adapters/s3": "src/adapters/s3.ts",
    "adapters/prisma": "src/adapters/prisma.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
