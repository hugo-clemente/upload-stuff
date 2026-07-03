/* oxlint-disable @typescript-eslint/no-explicit-any */
import { hc, parseResponse } from "hono/client";

import type { UploadStuffHTTPServerType } from "@upload-stuff/server/next";
import type {
  AnyFileRoute,
  AnyRouteConfig,
  CompleteUploadResult,
  InitUploadResult,
  UploadStuffRouter,
  inferRouteServerData,
} from "@upload-stuff/core";
import { DEFAULT_BASE_PATH, getValidMimeTypes, validateFiles } from "@upload-stuff/core";

import { type EndpointArg, resolveEndpoint } from "./endpoint";
import { mergeHeaders } from "./headers";
import { createProgressReporter } from "./progress";
import type { CreateUploadStuffClientOptions, UploadFilesArgs, UploadFilesOptions } from "./types";
import { uploadFileWithProgress } from "./upload";

/**
 * Derive an `<input accept>` string from a route's accepted file type(s).
 */
export const getAcceptFromType = (type: AnyRouteConfig["type"]) =>
  getValidMimeTypes(type).join(",");

export const createUploadStuffClient = <TFileRouter extends UploadStuffRouter>(
  options: CreateUploadStuffClientOptions,
) => {
  const basePath = options.basePath ?? DEFAULT_BASE_PATH;
  const honoClient = hc<UploadStuffHTTPServerType>(
    new URL(basePath, options.baseURL).toString(),
  );

  const fetchRouteConfig = (endpoint: string) =>
    parseResponse(
      honoClient[":endpoint"]["route-config"].$get({ param: { endpoint } }),
    ) as unknown as Promise<AnyRouteConfig>;

  // Config is fetched once per endpoint and cached for the client's lifetime.
  // The promise itself is the cache entry: concurrent callers share one
  // request, and a rejected entry evicts itself so the next call retries.
  const configs = new Map<string, Promise<AnyRouteConfig>>();
  const loadRouteConfig = (resolved: string, force?: boolean): Promise<AnyRouteConfig> => {
    if (force) configs.delete(resolved);
    let promise = configs.get(resolved);
    if (!promise) {
      promise = fetchRouteConfig(resolved).catch((e) => {
        configs.delete(resolved);
        throw e;
      });
      configs.set(resolved, promise);
    }
    return promise;
  };

  const getRouteConfig = <TEndpoint extends keyof TFileRouter>(
    endpoint: EndpointArg<TFileRouter, TEndpoint>,
    opts?: {
      /**
       * Drop the cached config and fetch fresh — the escape hatch when a
       * route's config changed server-side.
       */
      force?: boolean;
    },
  ) =>
    loadRouteConfig(
      resolveEndpoint<TFileRouter, TEndpoint>(endpoint) as string,
      opts?.force,
    ) as Promise<TFileRouter[TEndpoint]["routeConfig"]>;

  const uploadFiles = async <TEndpoint extends keyof TFileRouter>(
    endpoint: EndpointArg<TFileRouter, TEndpoint>,
    files: File[],
    ...args: UploadFilesArgs<TFileRouter[TEndpoint]>
  ): Promise<CompleteUploadResult<inferRouteServerData<TFileRouter[TEndpoint]>>> => {
    const resolved = resolveEndpoint<TFileRouter, TEndpoint>(endpoint) as string;
    const opts = (args[0] ?? {}) as UploadFilesOptions<AnyFileRoute> & { input?: any };

    // Rejecting (not silently returning) because the promise resolves with
    // the verified result — there is no result for zero files.
    if (files.length === 0) {
      throw new Error("No files provided.");
    }

    const requestHeaders = mergeHeaders(opts.headers);
    const signal = opts.signal;
    let onAbort: (() => void) | undefined;
    // In-flight PUT XHRs, so an abort can cancel the transfer mid-file.
    let currentXhrs: XMLHttpRequest[] = [];

    try {
      const routeConfig = opts.routeConfig ?? (await loadRouteConfig(resolved));

      const preparedFiles =
        (await opts.onBeforeUploadBegin?.({ files, config: routeConfig })) ?? files;

      const meta = preparedFiles.map((f) => ({
        filename: f.name,
        contentType: f.type || "application/octet-stream",
        size: f.size,
      }));

      validateFiles(meta, routeConfig);

      const uploadPlan = (await parseResponse(
        honoClient[":endpoint"]["init-upload"].$post(
          {
            param: { endpoint: resolved },
            json: { input: opts.input ?? null, files: meta } as any,
          },
          { headers: requestHeaders },
        ),
      )) as unknown as InitUploadResult;

      const totalBytes = preparedFiles.reduce((acc, f) => acc + f.size, 0);
      opts.onUploadProgress?.(0);
      const reportProgress = createProgressReporter({
        totalBytes,
        granularity: opts.uploadProgressGranularity,
        onProgress: opts.onUploadProgress,
      });

      const abort = () => {
        currentXhrs.forEach((x) => {
          try {
            x.abort();
          } catch {
            //do nothing
          }
        });
        currentXhrs = [];
      };

      if (signal) {
        if (signal.aborted) {
          abort();
          opts.onUploadAborted?.();
          throw new Error("Upload aborted.");
        }
        onAbort = () => {
          abort();
          opts.onUploadAborted?.();
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }

      for (let i = 0; i < preparedFiles.length; i++) {
        const f = preparedFiles[i]!;
        const plan = uploadPlan.files[i]!;

        let lastLoaded = 0;
        opts.onUploadBegin?.({ file: f.name });
        await uploadFileWithProgress({
          uploadUrl: plan.uploadUrl,
          uploadHeaders: plan.uploadHeaders,
          file: f,
          onProgress: (loaded) => {
            const delta = loaded - lastLoaded;
            lastLoaded = loaded;
            reportProgress(delta);
          },
          onInitXhr: (xhr) => currentXhrs.push(xhr),
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

      const verified = (await parseResponse(
        honoClient[":endpoint"]["complete-upload"].$post(
          { param: { endpoint: resolved }, json: { batchToken: uploadPlan.batchToken } },
          { headers: requestHeaders },
        ),
      )) as unknown as CompleteUploadResult<any>;

      // Only report 100% on success — a failed/aborted upload must not
      // leave the consumer's progress UI showing a completed bar.
      opts.onUploadProgress?.(100);
      opts.onClientUploadComplete?.(verified as any);
      return verified;
    } catch (e) {
      const err = e instanceof Error ? e : new Error("An error occurred during upload.");
      // An abort is already reported through onUploadAborted — don't
      // double-report it as an error.
      if (!signal?.aborted) {
        opts.onUploadError?.(err);
      }
      throw err;
    } finally {
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      currentXhrs = [];
    }
  };

  const client = { getRouteConfig, uploadFiles };
  // Phantom marker (never set at runtime): carries TFileRouter in a directly
  // inferable position so framework bindings can infer the router from the
  // instance — inference cannot see type parameters that only appear inside
  // generic method signatures.
  return client as typeof client & { "~router"?: TFileRouter };
};

export type UploadStuffClient<TFileRouter extends UploadStuffRouter> = ReturnType<
  typeof createUploadStuffClient<TFileRouter>
>;
