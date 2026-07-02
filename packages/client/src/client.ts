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
import type {
  CreateUploadStuffClientOptions,
  UploadFilesArgs,
  UploadFilesOptions,
} from "./types";
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
  const client = hc<UploadStuffHTTPServerType>(new URL(basePath, options.baseURL).toString());

  const fetchRouteConfig = async <TEndpoint extends keyof TFileRouter>(
    endpoint: EndpointArg<TFileRouter, TEndpoint>,
  ): Promise<TFileRouter[TEndpoint]["routeConfig"]> => {
    const resolved = resolveEndpoint<TFileRouter, TEndpoint>(endpoint);
    return (await parseResponse(
      client[":endpoint"]["route-config"].$get({ param: { endpoint: resolved as string } }),
    )) as TFileRouter[TEndpoint]["routeConfig"];
  };

  const uploadFiles = async <TEndpoint extends keyof TFileRouter>(
    endpoint: EndpointArg<TFileRouter, TEndpoint>,
    files: File[],
    ...args: UploadFilesArgs<TFileRouter[TEndpoint]>
  ): Promise<CompleteUploadResult<inferRouteServerData<TFileRouter[TEndpoint]>>> => {
    const opts = (args[0] ?? {}) as UploadFilesOptions<AnyFileRoute> & { input?: any };
    const resolved = resolveEndpoint<TFileRouter, TEndpoint>(endpoint) as string;

    // Rejecting (not silently returning) because the promise now resolves with
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
      const routeConfig = opts.routeConfig ?? (await fetchRouteConfig(endpoint));

      const preparedFiles =
        (await opts.onBeforeUploadBegin?.({ files, config: routeConfig })) ?? files;

      const meta = preparedFiles.map((f) => ({
        filename: f.name,
        contentType: f.type || "application/octet-stream",
        size: f.size,
      }));

      validateFiles(meta, routeConfig);

      const uploadPlan = (await parseResponse(
        client[":endpoint"]["init-upload"].$post(
          {
            param: { endpoint: resolved },
            json: { input: opts.input ?? null, files: meta },
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
        client[":endpoint"]["complete-upload"].$post(
          {
            param: { endpoint: resolved },
            json: { batchToken: uploadPlan.batchToken },
          },
          { headers: requestHeaders },
        ),
      )) as unknown as CompleteUploadResult<inferRouteServerData<TFileRouter[TEndpoint]>>;

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

  return { fetchRouteConfig, uploadFiles };
};

export type UploadStuffClient<TFileRouter extends UploadStuffRouter> = ReturnType<
  typeof createUploadStuffClient<TFileRouter>
>;
