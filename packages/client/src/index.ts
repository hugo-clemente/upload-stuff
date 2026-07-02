// The "use client" directive is injected into every output chunk by the
// vite.config.ts `pack.banner` — the bundler does not preserve a source-level
// one. (Legacy: the React surface moves to @upload-stuff/react; impl.ts and
// the banner are removed when that migration completes.)
export * from "./impl";

// Framework-free engine surface.
export { createUploadStuffClient, getAcceptFromType, type UploadStuffClient } from "./client";
export type {
  CreateUploadStuffClientOptions,
  UploadCallbacks,
  UploadFilesArgs,
  UploadFilesOptions,
} from "./types";
export { resolveEndpoint, type EndpointArg, type RouteRegistry } from "./endpoint";
export { mergeHeaders } from "./headers";
export type { ProgressGranularity } from "./progress";

// Re-export the core types that appear in this package's public API, so
// frontend consumers and framework bindings never import @upload-stuff/core
// directly.
export type {
  AnyFileRoute,
  AnyRouteConfig,
  CompleteUploadResult,
  InitUploadResult,
  RouteConfig,
  ToUploadFileData,
  UploadStuffRouter,
  UploadedFileData,
  inferRouteInput,
  inferRouteServerData,
} from "@upload-stuff/core";
