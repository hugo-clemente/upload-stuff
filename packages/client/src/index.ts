// Framework-free engine surface.
export { createUploadStuffClient, type UploadStuffClient } from "./client";
// Accept-string helper now lives in core (derives from the normalized `files` config).
export { getAcceptFromRouteConfig } from "@upload-stuff/core";
export { preprocessImages } from "./compress-images";
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
  NormalizedRouteConfig,
  RouteConfig,
  ToUploadFileData,
  UploadStuffRouter,
  UploadedFileData,
  inferRouteInput,
  inferRouteServerData,
} from "@upload-stuff/core";
