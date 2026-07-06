/* oxlint-disable @typescript-eslint/no-explicit-any */
import type {
  AnyFileRoute,
  CompleteUploadResult,
  InitUploadResult,
  NormalizedRouteConfig,
  UploadStuffRouter,
  inferRouteServerData,
} from "@upload-stuff/core";
import { DEFAULT_BASE_PATH, canonicalizeContentType, validateFiles } from "@upload-stuff/core";

import { type EndpointArg, resolveEndpoint } from "./endpoint";
import { mergeHeaders } from "./headers";
import { createProgressReporter } from "./progress";
import type { CreateUploadStuffClientOptions, UploadFilesArgs, UploadFilesOptions } from "./types";
import { uploadFileWithProgress } from "./upload";

export const createUploadStuffClient = <TFileRouter extends UploadStuffRouter>(
  options: CreateUploadStuffClientOptions,
) => {
  const basePath = options.basePath ?? DEFAULT_BASE_PATH;
  // Same base resolution as the previous hc(...) client: an absolute basePath
  // replaces any path on baseURL. Trailing slash stripped so joins stay clean.
  const base = new URL(basePath, options.baseURL).toString().replace(/\/$/, "");
  const endpointUrl = (endpoint: string, action: string) =>
    `${base}/${encodeURIComponent(endpoint)}/${action}`;

  const responseError = async (res: Response): Promise<Error> => {
    let message = `${res.status} ${res.statusText}`;
    let data: unknown;
    try {
      if (res.headers.get("content-type")?.includes("json")) {
        data = await res.json();
        const serverMessage = (data as { error?: unknown } | null)?.error;
        if (typeof serverMessage === "string") message = serverMessage;
      } else {
        const text = await res.text();
        if (text) message = text;
      }
    } catch {
      // unreadable body — keep the status-line fallback
    }
    return Object.assign(new Error(message), { status: res.status, data });
  };

  const requestJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(url, init);
    if (!res.ok) throw await responseError(res);
    return (await res.json()) as T;
  };

  const fetchRouteConfig = async (endpoint: string): Promise<NormalizedRouteConfig> => {
    const config = await requestJson<NormalizedRouteConfig>(endpointUrl(endpoint, "route-config"));
    // An older @upload-stuff/server serves the pre-`files` payload; without this guard the
    // mismatch surfaces as an opaque TypeError deep inside matching. Fail loud.
    if (typeof config.files !== "object" || config.files === null) {
      throw new Error(
        "upload-stuff: route-config response is missing `files` - upgrade @upload-stuff/server to match the client.",
      );
    }
    return config;
  };

  // Config is fetched once per endpoint and cached for the client's lifetime.
  // Two maps, kept distinct on purpose: `good` holds the last *resolved* config
  // (only successes land here); `inflight` holds the fetch currently running so
  // every caller — forced or not — dedupes onto one request. `force` doesn't
  // bypass the cache; it means "the resolved value is stale, refetch" while
  // still riding any in-flight fetch. A rejection never enters `good`, so it
  // can't poison the cache, and stale beats broken falls out for free.
  const good = new Map<string, NormalizedRouteConfig>();
  const inflight = new Map<string, Promise<NormalizedRouteConfig>>();
  const loadRouteConfig = (resolved: string, force?: boolean): Promise<NormalizedRouteConfig> => {
    if (!force && good.has(resolved)) return Promise.resolve(good.get(resolved)!);
    const pending = inflight.get(resolved);
    if (pending) return pending;

    const fresh = fetchRouteConfig(resolved);
    inflight.set(resolved, fresh);
    // Promote-and-clear in the same settle handler (not a trailing .finally) so
    // `inflight` is cleared before any awaiting caller resumes — otherwise a
    // forced refetch fired right after the previous load resolves would dedupe
    // onto the stale, already-settled promise instead of refetching.
    const done = () => {
      if (inflight.get(resolved) === fresh) inflight.delete(resolved);
    };
    void fresh.then(
      (config) => {
        good.set(resolved, config);
        done();
      },
      // Failure keeps the last good config; nothing is stored, so the next call
      // refetches instead of replaying a rejection.
      done,
    );
    return fresh;
  };

  const getRouteConfig = <TEndpoint extends keyof TFileRouter>(
    endpoint: EndpointArg<TFileRouter, TEndpoint>,
    opts?: {
      /**
       * Treat the cached config as stale and refetch — the escape hatch when a
       * route's config changed server-side. Still deduped: a fetch already in
       * flight is shared rather than duplicated, and the last good config keeps
       * serving until the refresh resolves.
       */
      force?: boolean;
    },
  ) =>
    loadRouteConfig(
      resolveEndpoint<TFileRouter, TEndpoint>(endpoint) as string,
      opts?.force,
      // The server serves the NORMALIZED config, not the authored `routeConfig`.
    ) as Promise<NormalizedRouteConfig<TFileRouter[TEndpoint]["$types"]["fileUsageContext"]>>;

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
    let abortGoverns = true;
    // In-flight PUT XHRs, so an abort can cancel the transfer mid-file.
    let currentXhrs: XMLHttpRequest[] = [];

    let abortReported = false;
    const reportAbort = () => {
      if (abortReported) return;
      abortReported = true;
      opts.onUploadAborted?.();
    };
    // Reject as soon as the run aborts without cancelling `p` — it's a shared,
    // cached fetch other callers still await.
    const untilAbort = <T>(p: Promise<T>): Promise<T> => {
      if (!signal) return p;
      return new Promise<T>((resolve, reject) => {
        const onSignal = () => reject(new Error("Upload aborted."));
        signal.addEventListener("abort", onSignal, { once: true });
        const stop = () => signal.removeEventListener("abort", onSignal);
        p.then(
          (v) => {
            stop();
            resolve(v);
          },
          (e) => {
            stop();
            reject(e);
          },
        );
      });
    };

    try {
      if (signal?.aborted) throw new Error("Upload aborted.");

      const routeConfig = opts.routeConfig ?? (await untilAbort(loadRouteConfig(resolved)));

      const preparedFiles =
        (await opts.onBeforeUploadBegin?.({ files, config: routeConfig })) ?? files;

      // Send the canonical (un-folded) content type so the client pre-flight and the server
      // match on the honest value; the server folds to a storage-safe value and returns it as
      // `plan.contentType` for the PUT.
      const meta = preparedFiles.map((f) => ({
        filename: f.name,
        contentType: canonicalizeContentType(f.type),
        size: f.size,
      }));

      validateFiles(meta, routeConfig);

      // Bail before init-upload creates server-side state we'd then orphan.
      if (signal?.aborted) throw new Error("Upload aborted.");

      const uploadPlan = await untilAbort(
        requestJson<InitUploadResult>(endpointUrl(resolved, "init-upload"), {
          method: "POST",
          headers: { "content-type": "application/json", ...requestHeaders },
          body: JSON.stringify({ input: opts.input ?? null, files: meta }),
          // Cancels the request itself on abort; untilAbort keeps the
          // rejection prompt and the shared route-config semantics unchanged.
          signal,
        }),
      );

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
        if (signal.aborted) throw new Error("Upload aborted.");
        onAbort = () => {
          abort();
          reportAbort();
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
          // Replay the server's signed/stored content type, not the raw file.type, so the
          // PUT Content-Type matches the presigned signature and S3 verifyUpload.
          contentType: plan.contentType,
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

      abortGoverns = false;

      const verified = await requestJson<CompleteUploadResult<any>>(
        endpointUrl(resolved, "complete-upload"),
        {
          method: "POST",
          headers: { "content-type": "application/json", ...requestHeaders },
          body: JSON.stringify({ batchToken: uploadPlan.batchToken }),
        },
      );

      // Only report 100% on success — a failed/aborted upload must not
      // leave the consumer's progress UI showing a completed bar.
      opts.onUploadProgress?.(100);
      opts.onClientUploadComplete?.(verified as any);
      return verified;
    } catch (e) {
      const aborted = abortGoverns && signal?.aborted;
      const err = aborted
        ? new Error("Upload aborted.")
        : e instanceof Error
          ? e
          : new Error("An error occurred during upload.");
      if (aborted) reportAbort();
      else opts.onUploadError?.(err);
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
