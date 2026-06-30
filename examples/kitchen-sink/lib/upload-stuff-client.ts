"use client";

import { createUploadStuffReactHelpers } from "@upload-stuff/client";

import type { FileRouter } from "./file-router";

// Same-origin: a relative basePath resolved against the current origin. The
// localhost fallback is only used when this module is evaluated during SSR; the
// hc client is never actually called from the server.
export const { useUploadStuff } = createUploadStuffReactHelpers<FileRouter>({
  baseURL: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
});
