import { useCallback, useMemo, useRef, useState } from "react";

import { type InferRequestType, hc, parseResponse } from "hono/client";
import useSWR from "swr";
import { match } from "ts-pattern";
import type { SetOptional } from "type-fest";

import type { UploadStuffHTTPServerType } from "@upload-stuff/server/next";
import type {
  AnyFileRoute,
  AnyRouteConfig,
  CompleteUploadResult,
  InitUploadResult,
  RouteConfig,
  UploadStuffRouter,
  inferRouteInput,
  inferRouteServerData,
} from "@upload-stuff/core";
import {
  DEFAULT_BASE_PATH,
  getFileSizeInBytes,
  getValidMimeTypes,
  validateFiles,
} from "@upload-stuff/core";

import { compressImage } from "./compress-images";
import { type EndpointArg, resolveEndpoint } from "./endpoint";
import { mergeHeaders } from "./headers";
import { uploadFileWithProgress } from "./upload";

/* oxlint-disable @typescript-eslint/no-explicit-any */

export interface CreateUploadStuffClientOptions {
  baseURL: string;
  basePath?: string;
}

const getOptions = (options: CreateUploadStuffClientOptions) => {
  const { baseURL } = options;

  const basePath = options.basePath ?? DEFAULT_BASE_PATH;

  const client = hc<UploadStuffHTTPServerType>(new URL(basePath, baseURL).toString());

  return {
    client,
  };
};

export const createUploadStuffReactHelpers = <TFileRouter extends UploadStuffRouter>(
  options: SetOptional<CreateUploadStuffClientOptions, "basePath">,
) => {
  const { client } = getOptions(options);

  const useRouteConfig = <TEndpoint extends keyof TFileRouter>(endpoint: TEndpoint) => {
    const $get = client[":endpoint"]["route-config"].$get;

    const fetcher = (arg: InferRequestType<typeof $get>) => async () => {
      const res = await $get(arg);
      return (await res.json()) as TFileRouter[TEndpoint]["routeConfig"];
    };

    return useSWR(
      `upload-stuff/${endpoint as string}/route-config`,
      fetcher({ param: { endpoint: endpoint as string } }),
    );
  };

  const useUploadStuff = <
    TEndpoint extends keyof TFileRouter,
    TRoute extends TFileRouter[TEndpoint],
  >(
    endpoint: EndpointArg<TFileRouter, TEndpoint>,
    opts?: UseUploadStuffOptions<TRoute>,
  ): UseUploadStuffReturn<TRoute> => {
    const [isUploading, setIsUploading] = useState(false);

    // Synchronous re-entrancy guard. `isUploading` state updates on the next
    // render, so a second startUpload call in the same tick would slip past it
    // and corrupt the shared progress/XHR refs below.
    const isUploadingRef = useRef(false);
    const totalBytesRef = useRef(0);
    const uploadedBytesRef = useRef(0);
    const lastReportedPercentRef = useRef(0);
    const currentXhrsRef = useRef<XMLHttpRequest[]>([]);

    const resolvedEndpoint = useMemo(
      () => resolveEndpoint<TFileRouter, TEndpoint>(endpoint),
      [endpoint],
    );

    const { data: routeConfig, isLoading } = useRouteConfig(resolvedEndpoint as string);

    const accept = useMemo(
      () => (routeConfig ? getAcceptFromType(routeConfig.type) : undefined),
      [routeConfig],
    );

    const initMutation = useCallback(
      (...args: Parameters<(typeof client)[":endpoint"]["init-upload"]["$post"]>) => {
        return parseResponse(
          client[":endpoint"]["init-upload"].$post(...args),
        ) as unknown as Promise<InitUploadResult>;
      },
      [],
    );

    const completeMutation = useCallback(
      (...args: Parameters<(typeof client)[":endpoint"]["complete-upload"]["$post"]>) => {
        return parseResponse(
          client[":endpoint"]["complete-upload"].$post(...args),
        ) as unknown as Promise<CompleteUploadResult<inferRouteServerData<TRoute>>>;
      },
      [],
    );

    const reportProgress = useCallback(
      (extraUploaded: number) => {
        uploadedBytesRef.current += extraUploaded;
        const total = totalBytesRef.current || 1;
        const percent = Math.min(100, Math.round((uploadedBytesRef.current / total) * 100));
        const granularity = opts?.uploadProgressGranularity ?? "coarse";
        if (granularity === "all") {
          opts?.onUploadProgress?.(percent);
          lastReportedPercentRef.current = percent;
          return;
        }

        const step = match(granularity)
          .with("fine", () => 1)
          .with("coarse", () => 10)
          .exhaustive();

        if (
          percent === 100 ||
          percent - lastReportedPercentRef.current >= step ||
          Math.floor(percent / step) !== Math.floor(lastReportedPercentRef.current / step)
        ) {
          opts?.onUploadProgress?.(percent);
          lastReportedPercentRef.current = percent;
        }
      },
      [opts],
    );

    const startUpload = useCallback<StartUploadFn<TRoute>>(
      async (files: File[], input: any, runOpts?: StartUploadFnOptions) => {
        if (!routeConfig) throw new Error("Route config not loaded yet");
        if (!files || files.length === 0) return;
        if (isUploadingRef.current) {
          throw new Error("An upload is already in progress");
        }
        isUploadingRef.current = true;

        const requestHeaders = mergeHeaders(opts?.headers, runOpts?.headers);

        const signal = runOpts?.signal;
        let onAbort: (() => void) | undefined;

        try {
          setIsUploading(true);
          currentXhrsRef.current = [];

          const preparedFiles =
            (await opts?.onBeforeUploadBegin?.({
              files,
              config: routeConfig,
            })) ?? files;

          const meta = preparedFiles.map((f) => ({
            filename: f.name,
            contentType: f.type || "application/octet-stream",
            size: f.size,
          }));

          validateFiles(meta, routeConfig);

          const uploadPlan = await initMutation(
            {
              param: {
                endpoint: resolvedEndpoint as string,
              },
              json: {
                input: input ?? null,
                files: meta,
              },
            },
            { headers: requestHeaders },
          );

          totalBytesRef.current = preparedFiles.reduce((acc, f) => acc + f.size, 0);

          uploadedBytesRef.current = 0;
          lastReportedPercentRef.current = 0;
          opts?.onUploadProgress?.(0);

          const abort = () => {
            currentXhrsRef.current.forEach((x) => {
              try {
                x.abort();
              } catch {
                //do nothing
              }
            });
            currentXhrsRef.current = [];
          };

          if (signal) {
            if (signal.aborted) {
              abort();
              opts?.onUploadAborted?.();
              throw new Error("Upload aborted.");
            }
            onAbort = () => {
              abort();
              opts?.onUploadAborted?.();
            };
            signal.addEventListener("abort", onAbort, { once: true });
          }

          for (let i = 0; i < preparedFiles.length; i++) {
            const f = preparedFiles[i]!;
            const plan = uploadPlan.files[i]!;

            let lastLoaded = 0;
            opts?.onUploadBegin?.({ file: f.name });
            await uploadFileWithProgress({
              uploadUrl: plan.uploadUrl,
              uploadHeaders: plan.uploadHeaders,
              file: f,
              onProgress: (loaded) => {
                const delta = loaded - lastLoaded;
                lastLoaded = loaded;
                reportProgress(delta);
              },
              onInitXhr: (xhr) => currentXhrsRef.current.push(xhr),
              signal,
            });
          }

          // The abort signal only governs the byte transfer. With all files in
          // storage, stop listening — aborting completion would fire both
          // onUploadAborted and onClientUploadComplete for the same upload.
          if (signal && onAbort) {
            signal.removeEventListener("abort", onAbort);
            onAbort = undefined;
          }
          // Abort fired between the last upload finishing and this point: the
          // listener already reported it, so don't finalize the batch.
          if (signal?.aborted) {
            throw new Error("Upload aborted.");
          }

          const verified = await completeMutation(
            {
              param: {
                endpoint: resolvedEndpoint as string,
              },
              json: {
                batchToken: uploadPlan.batchToken,
              },
            },
            { headers: requestHeaders },
          );

          // Only report 100% on success — a failed/aborted upload must not
          // leave the consumer's progress UI showing a completed bar.
          opts?.onUploadProgress?.(100);
          opts?.onClientUploadComplete?.(verified);
          return;
        } catch (e) {
          const err = e instanceof Error ? e : new Error("An error occurred during upload.");
          // An abort is already reported through onUploadAborted — don't
          // double-report it as an error.
          if (!signal?.aborted) {
            opts?.onUploadError?.(err);
          }
          throw err;
        } finally {
          if (signal && onAbort) signal.removeEventListener("abort", onAbort);
          currentXhrsRef.current = [];
          isUploadingRef.current = false;
          setIsUploading(false);
        }
      },
      [opts, reportProgress, routeConfig, initMutation, completeMutation, resolvedEndpoint],
    );

    return {
      startUpload,
      isUploading,
      routeConfig,
      accept,
      isLoading,
    };
  };

  return {
    useRouteConfig,
    useUploadStuff,
  };
};

type UseUploadStuffOptions<TRoute extends AnyFileRoute> = {
  headers?: HeadersInit;
  signal?: AbortSignal;

  onBeforeUploadBegin?: (params: {
    files: File[];
    config: RouteConfig<TRoute["$types"]["fileUsageContext"]>;
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
  uploadProgressGranularity?: "all" | "fine" | "coarse";
};

export type StartUploadFnOptions = {
  signal?: AbortSignal;
  headers?: HeadersInit;
};

export type StartUploadFn<TRoute extends AnyFileRoute> =
  inferRouteInput<TRoute> extends undefined
    ? (files: File[], input?: undefined, options?: StartUploadFnOptions) => Promise<void>
    : (
        files: File[],
        input: inferRouteInput<TRoute>,
        options?: StartUploadFnOptions,
      ) => Promise<void>;

export type UseUploadStuffReturn<TRoute extends AnyFileRoute> = {
  startUpload: StartUploadFn<TRoute>;
  /**
   * Is the hook ready to be used?
   */
  isLoading: boolean;
  /**
   * Are files currently being uploaded?
   */
  isUploading: boolean;
  routeConfig?: RouteConfig<TRoute["$types"]["fileUsageContext"]>;
  accept?: string;
};


export const preprocessImages =
  (maxWidthOrHeight?: number): UseUploadStuffOptions<any>["onBeforeUploadBegin"] =>
  async ({ files, config }) => {
    const maxSize = config?.maxFileSize;

    if (!maxSize && !maxWidthOrHeight) {
      return files;
    }

    const maxSizeBytes = maxSize ? getFileSizeInBytes(maxSize) : undefined;
    const maxSizeMB = maxSizeBytes ? maxSizeBytes / 1024 / 1024 : undefined;

    return Promise.all(
      files.map((file) => {
        return compressImage(file, { maxWidthOrHeight, maxSizeMB });
      }),
    );
  };

const getAcceptFromType = (type: AnyRouteConfig["type"]) => getValidMimeTypes(type).join(",");
