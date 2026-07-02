/* oxlint-disable @typescript-eslint/no-explicit-any */
import type {
  AnyFileRoute,
  AnyRouteConfig,
  CompleteUploadResult,
  InitUploadResult,
  inferRouteServerData,
} from "@upload-stuff/core";
import { validateFiles } from "@upload-stuff/core";

import { mergeHeaders } from "./headers";
import { createProgressReporter } from "./progress";
import { type ExternalStore, createStore } from "./store";
import type { UploadFilesArgs, UploadFilesOptions } from "./types";
import { uploadFileWithProgress } from "./upload";

export type UploadStatus = "idle" | "uploading" | "success" | "error" | "aborted";

export type UploadSnapshot<TRoute extends AnyFileRoute> = {
  status: UploadStatus;
  progressPercent: number;
  result?: CompleteUploadResult<inferRouteServerData<TRoute>>;
  error?: Error;
};

export type UploadController<TRoute extends AnyFileRoute> = ExternalStore<UploadSnapshot<TRoute>> & {
  start: (
    files: File[],
    ...args: UploadFilesArgs<TRoute>
  ) => Promise<CompleteUploadResult<inferRouteServerData<TRoute>>>;
  abort: () => void;
};

/**
 * What a run needs from the transport layer — built per-endpoint by the
 * client so the controller stays hono-free and unit-testable.
 */
export type UploadRunDeps = {
  loadRouteConfig: () => Promise<AnyRouteConfig>;
  initUpload: (
    json: { input: unknown; files: Array<{ filename: string; contentType: string; size: number }> },
    headers: Record<string, string>,
  ) => Promise<InitUploadResult>;
  completeUpload: (
    json: { batchToken: string },
    headers: Record<string, string>,
  ) => Promise<CompleteUploadResult<any>>;
};

/**
 * The upload orchestration — moved verbatim from client.ts's uploadFiles.
 * `opts.signal` here is already the controller-composed signal.
 */
const runUpload = async (
  deps: UploadRunDeps,
  files: File[],
  opts: UploadFilesOptions<AnyFileRoute> & { input?: any },
): Promise<CompleteUploadResult<any>> => {
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
    const routeConfig = opts.routeConfig ?? (await deps.loadRouteConfig());

    const preparedFiles = (await opts.onBeforeUploadBegin?.({ files, config: routeConfig })) ?? files;

    const meta = preparedFiles.map((f) => ({
      filename: f.name,
      contentType: f.type || "application/octet-stream",
      size: f.size,
    }));

    validateFiles(meta, routeConfig);

    const uploadPlan = await deps.initUpload({ input: opts.input ?? null, files: meta }, requestHeaders);

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

    const verified = await deps.completeUpload({ batchToken: uploadPlan.batchToken }, requestHeaders);

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

export const createUploadController = <TRoute extends AnyFileRoute>(
  deps: UploadRunDeps,
): UploadController<TRoute> => {
  const initial: UploadSnapshot<TRoute> = { status: "idle", progressPercent: 0 };
  const store = createStore<UploadSnapshot<TRoute>>(initial);
  // Per-run identity: snapshot transitions fire before user callbacks, so a
  // terminal callback (onClientUploadComplete/onUploadError/onUploadAborted)
  // may synchronously call start() again before the old run's frame has
  // unwound. The old run's safety-net catch/finally must recognize it's no
  // longer the active run and leave the new run's state alone.
  let activeRun: { abortController: AbortController } | undefined;

  const start = async (files: File[], ...args: UploadFilesArgs<TRoute>) => {
    if (store.getSnapshot().status === "uploading") {
      // Async function → rejected promise, matching the hook's tested behavior.
      throw new Error("An upload is already in progress");
    }
    const opts = (args[0] ?? {}) as UploadFilesOptions<AnyFileRoute> & { input?: any };

    const run = { abortController: new AbortController() };
    activeRun = run;
    const { abortController } = run;
    const callerSignal = opts.signal;
    let onCallerAbort: (() => void) | undefined;
    if (callerSignal) {
      if (callerSignal.aborted) {
        abortController.abort();
      } else {
        onCallerAbort = () => abortController.abort();
        callerSignal.addEventListener("abort", onCallerAbort, { once: true });
      }
    }

    // A run starts from a fresh snapshot — result/error from prior runs drop.
    store.set({ status: "uploading", progressPercent: 0 });
    const transition = (partial: Partial<UploadSnapshot<TRoute>>) =>
      store.set({ ...store.getSnapshot(), ...partial });

    // Snapshot transitions happen BEFORE the user's callback so a callback
    // reading getSnapshot() sees consistent state.
    const wrapped: typeof opts = {
      ...opts,
      signal: abortController.signal,
      onUploadProgress: (percent) => {
        if (store.getSnapshot().progressPercent !== percent) {
          transition({ progressPercent: percent });
        }
        opts.onUploadProgress?.(percent);
      },
      onUploadAborted: () => {
        transition({ status: "aborted" });
        opts.onUploadAborted?.();
      },
      onClientUploadComplete: (result) => {
        transition({ status: "success", result: result as any });
        opts.onClientUploadComplete?.(result);
      },
      onUploadError: (error) => {
        transition({ status: "error", error });
        opts.onUploadError?.(error);
      },
    };

    try {
      return (await runUpload(deps, files, wrapped)) as CompleteUploadResult<
        inferRouteServerData<TRoute>
      >;
    } catch (e) {
      // Rejections that bypass the callbacks (e.g. empty files) must still
      // settle the status — but only if this run is still the active one;
      // a terminal callback may have synchronously started a new run while
      // this frame was unwinding, and that run's snapshot must not be
      // touched.
      if (activeRun === run && store.getSnapshot().status === "uploading") {
        transition({
          status: abortController.signal.aborted ? "aborted" : "error",
          error: e instanceof Error ? e : new Error(String(e)),
        });
      }
      throw e;
    } finally {
      if (callerSignal && onCallerAbort) callerSignal.removeEventListener("abort", onCallerAbort);
      if (activeRun === run) activeRun = undefined;
    }
  };

  // Defined by equivalence with a caller signal firing at this moment —
  // including the ignored-late-abort boundary. No-op when not uploading.
  const abort = () => activeRun?.abortController.abort();

  return {
    subscribe: store.subscribe,
    getSnapshot: store.getSnapshot,
    getServerSnapshot: store.getServerSnapshot,
    start: start as UploadController<TRoute>["start"],
    abort,
  };
};
