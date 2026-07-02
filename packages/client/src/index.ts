// Framework-free engine surface.
export { createUploadStuffClient, getAcceptFromType, type UploadStuffClient } from "./client";
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
export type { ExternalStore } from "./store";
export type { RouteConfigHandle, RouteConfigSnapshot } from "./route-config";
export type { UploadController, UploadSnapshot, UploadStatus } from "./upload-controller";

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
