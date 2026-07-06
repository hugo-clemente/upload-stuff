import type {
  AnyFileRoute,
  CompleteUploadResult,
  NormalizedRouteConfig,
  inferRouteInput,
  inferRouteServerData,
} from "@upload-stuff/core";

import type { ProgressGranularity } from "./progress";

export interface CreateUploadStuffClientOptions {
  baseURL: string;
  basePath?: string;
}

export type UploadCallbacks<TRoute extends AnyFileRoute> = {
  onBeforeUploadBegin?: (params: {
    files: File[];
    config: NormalizedRouteConfig<TRoute["$types"]["fileUsageContext"]>;
  }) => Promise<File[]> | File[];
  onUploadBegin?: (params: { file: string }) => void;
  /**
   * Global progress
   */
  onUploadProgress?: (progressPercent: number) => void;
  /**
   * Callback that runs *after* the server-side onUploadComplete
   */
  onClientUploadComplete?: (res: CompleteUploadResult<inferRouteServerData<TRoute>>) => void;
  onUploadError?: (error: Error) => void;
  onUploadAborted?: () => void;
  uploadProgressGranularity?: ProgressGranularity;
};

export type UploadFilesOptions<TRoute extends AnyFileRoute> = UploadCallbacks<TRoute> & {
  signal?: AbortSignal;
  headers?: HeadersInit;
  /**
   * Skip the engine's route-config fetch when the caller already has the
   * config (e.g. a framework binding that fetched it for UI state).
   */
  routeConfig?: NormalizedRouteConfig<TRoute["$types"]["fileUsageContext"]>;
};

export type UploadFilesArgs<TRoute extends AnyFileRoute> =
  inferRouteInput<TRoute> extends undefined
    ? [options?: UploadFilesOptions<TRoute> & { input?: undefined }]
    : [options: UploadFilesOptions<TRoute> & { input: inferRouteInput<TRoute> }];
