"use client";

import { createUploadStuffClient } from "@upload-stuff/client";
import { createUploadStuffReactHelpers } from "@upload-stuff/react";

import type { FileRouter } from "./file-router";

// Same-origin: a relative basePath resolved against the current origin. The
// localhost fallback is only used when this module is evaluated during SSR; the
// hc client is never actually called from the server.
const client = createUploadStuffClient<FileRouter>({
  baseURL: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
});

export const { useUploadStuff } = createUploadStuffReactHelpers<FileRouter>(client);
