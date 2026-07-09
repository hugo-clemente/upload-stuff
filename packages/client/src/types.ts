import type {
  AnyFileRoute,
  CompleteUploadResult,
  NormalizedRouteConfig,
  inferRouteInput,
  inferRouteServerData,
} from "@upload-stuff/core";

import type { ProgressGranularity } from "./progress";

export interface CreateUploadStuffClientOptions {
  /** Origin the upload API is served from, e.g. `"https://app.example.com"`. */
  baseURL: string;
  /** Path the handler is mounted under. @default "/api/upload-stuff" */
  basePath?: string;
}

/** Lifecycle callbacks fired during an upload run. */
export type UploadCallbacks<TRoute extends AnyFileRoute> = {
  /** Transform files before upload begins (e.g. client-side compression); return the files to send. */
  onBeforeUploadBegin?: (params: {
    files: File[];
    config: NormalizedRouteConfig;
  }) => Promise<File[]> | File[];
  /** Fired as each file's transfer starts. */
  onUploadBegin?: (params: { file: string }) => void;
  /** Whole-run progress percent (0–100), throttled by `uploadProgressGranularity`. */
  onUploadProgress?: (progressPercent: number) => void;
  /** Fired after the server's `onUploadComplete`, with the verified result. */
  onClientUploadComplete?: (res: CompleteUploadResult<inferRouteServerData<TRoute>>) => void;
  /** Fired on any non-abort failure. */
  onUploadError?: (error: Error) => void;
  /** Fired once when the upload is aborted via its `AbortSignal`. */
  onUploadAborted?: () => void;
  /** How often `onUploadProgress` fires. @default "coarse" */
  uploadProgressGranularity?: ProgressGranularity;
};

/** Options for a single `uploadFiles` call: the lifecycle callbacks plus per-run controls. */
export type UploadFilesOptions<TRoute extends AnyFileRoute> = UploadCallbacks<TRoute> & {
  /** Abort the byte transfer (completion is not aborted once all files are stored). */
  signal?: AbortSignal;
  /** Extra headers sent on the init and complete requests (e.g. auth). */
  headers?: HeadersInit;
  /**
   * Skip the engine's route-config fetch when the caller already has the
   * config (e.g. a framework binding that fetched it for UI state).
   */
  routeConfig?: NormalizedRouteConfig;
};

/** Trailing `uploadFiles` args: `options` is optional, but its `input` is required when the route declares `.input()`. */
export type UploadFilesArgs<TRoute extends AnyFileRoute> =
  inferRouteInput<TRoute> extends undefined
    ? [options?: UploadFilesOptions<TRoute> & { input?: undefined }]
    : [options: UploadFilesOptions<TRoute> & { input: inferRouteInput<TRoute> }];
