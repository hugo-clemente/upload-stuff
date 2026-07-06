/* oxlint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createUploadStuffClient } from "./client";
import { MockXHR } from "./test/mock-xhr";
import {
  jsonResponse,
  mockFetch,
  png,
  testCompleteResult,
  testRouteConfig,
  testUploadPlan,
  waitForXhrs,
} from "./test/harness";

const makeClient = () => createUploadStuffClient<any>({ baseURL: "https://app.example.com" });

beforeEach(() => {
  MockXHR.reset();
  vi.stubGlobal("XMLHttpRequest", MockXHR);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadFiles — happy path", () => {
  it("runs init → PUT → complete, returns the verified result, fires callbacks", async () => {
    const { calls } = mockFetch();
    const onClientUploadComplete = vi.fn();
    const onUploadBegin = vi.fn();
    const onUploadProgress = vi.fn();
    const client = makeClient();

    const p = client.uploadFiles("image", [png()], {
      input: { caption: "hi" },
      headers: { "x-user-id": "u1" },
      uploadProgressGranularity: "all",
      onClientUploadComplete,
      onUploadBegin,
      onUploadProgress,
    });
    await waitForXhrs(1);
    const xhr = MockXHR.instances[0]!;
    xhr.emitProgress(1000);
    xhr.respond(200);

    const result = await p;
    expect(result).toEqual(testCompleteResult);
    expect(onClientUploadComplete).toHaveBeenCalledWith(testCompleteResult);
    expect(onUploadBegin).toHaveBeenCalledWith({ file: "a.png" });
    // 0 fires right after init; the explicit 100 only fires on success.
    expect(onUploadProgress.mock.calls[0]![0]).toBe(0);
    expect(onUploadProgress.mock.calls.at(-1)![0]).toBe(100);

    // Signed headers replayed on the PUT.
    expect(xhr.requestHeaders["x-amz-meta-user"]).toBe("u1");

    // Consumer headers reach both mutations; the init body carries input + file meta.
    const initCall = calls.find((c) => c.pathname.endsWith("/init-upload"))!;
    expect(initCall.request.headers.get("x-user-id")).toBe("u1");
    await expect(initCall.request.json()).resolves.toEqual({
      input: { caption: "hi" },
      files: [{ filename: "a.png", contentType: "image/png", size: 1000 }],
    });
    const completeCall = calls.find((c) => c.pathname.endsWith("/complete-upload"))!;
    expect(completeCall.request.headers.get("x-user-id")).toBe("u1");
    await expect(completeCall.request.json()).resolves.toEqual({ batchToken: "batch-token-1" });
  });

  it("uploads multiple files sequentially with aggregate progress", async () => {
    const twoFilePlan = {
      batchToken: "batch-token-2",
      files: [
        { ...testUploadPlan.files[0]!, uploadUrl: "https://storage.example.com/put/1" },
        {
          ...testUploadPlan.files[0]!,
          id: "file-2",
          key: "k2",
          filename: "b.png",
          size: 400,
          uploadUrl: "https://storage.example.com/put/2",
        },
      ],
    };
    mockFetch({ init: () => jsonResponse(twoFilePlan) });
    const onUploadBegin = vi.fn();
    const onUploadProgress = vi.fn();
    const client = makeClient();

    const p = client.uploadFiles("image", [png(600, "a.png"), png(400, "b.png")], {
      uploadProgressGranularity: "coarse",
      onUploadBegin,
      onUploadProgress,
    });
    await waitForXhrs(1);
    MockXHR.instances[0]!.emitProgress(600);
    MockXHR.instances[0]!.respond(200);
    await waitForXhrs(2);
    MockXHR.instances[1]!.emitProgress(400);
    MockXHR.instances[1]!.respond(200);
    await p;

    expect(onUploadBegin.mock.calls.map(([a]) => a)).toEqual([{ file: "a.png" }, { file: "b.png" }]);
    // 600/1000 → 60, then 1000/1000 → 100 (plus the leading 0 and final 100).
    expect(onUploadProgress.mock.calls.map(([p]) => p)).toEqual([0, 60, 100, 100]);
  });

  it("onBeforeUploadBegin can replace the files that get uploaded", async () => {
    const { calls } = mockFetch();
    const client = makeClient();
    const replacement = png(500, "compressed.png");

    const p = client.uploadFiles("image", [png(1000, "original.png")], {
      onBeforeUploadBegin: () => [replacement],
    });
    await waitForXhrs(1);
    MockXHR.instances[0]!.respond(200);
    await p;

    const initCall = calls.find((c) => c.pathname.endsWith("/init-upload"))!;
    await expect(initCall.request.json()).resolves.toEqual({
      input: null,
      files: [{ filename: "compressed.png", contentType: "image/png", size: 500 }],
    });
  });

  it("allows two concurrent runs without cross-talk", async () => {
    mockFetch();
    const client = makeClient();
    const progressA = vi.fn();
    const progressB = vi.fn();

    const pa = client.uploadFiles("image", [png()], { onUploadProgress: progressA });
    const pb = client.uploadFiles("image", [png()], { onUploadProgress: progressB });
    await waitForXhrs(2);
    MockXHR.instances[0]!.respond(200);
    MockXHR.instances[1]!.respond(200);
    await Promise.all([pa, pb]);

    expect(progressA.mock.calls.at(-1)![0]).toBe(100);
    expect(progressB.mock.calls.at(-1)![0]).toBe(100);
  });
});

describe("uploadFiles — route config", () => {
  it("fetches route config on demand when not provided", async () => {
    const { calls } = mockFetch();
    const client = makeClient();
    const p = client.uploadFiles("image", [png()]);
    await waitForXhrs(1);
    MockXHR.instances[0]!.respond(200);
    await p;
    expect(calls.some((c) => c.pathname.endsWith("/route-config"))).toBe(true);
  });

  it("skips the route-config fetch when the caller passes routeConfig", async () => {
    const { calls } = mockFetch();
    const client = makeClient();
    const p = client.uploadFiles("image", [png()], { routeConfig: testRouteConfig as any });
    await waitForXhrs(1);
    MockXHR.instances[0]!.respond(200);
    await p;
    expect(calls.some((c) => c.pathname.endsWith("/route-config"))).toBe(false);
  });

  it("supports the (r) => r.route selector", async () => {
    const { calls } = mockFetch();
    const client = makeClient();
    const p = client.uploadFiles((r: any) => r.image, [png()]);
    await waitForXhrs(1);
    MockXHR.instances[0]!.respond(200);
    await p;
    expect(calls[0]!.pathname).toContain("/image/");
  });
});

describe("uploadFiles — failures", () => {
  it("rejects on client-side validation failure before any request beyond route-config", async () => {
    const { calls } = mockFetch();
    const onUploadError = vi.fn();
    const client = makeClient();
    // 10MB file against the 4MB route limit.
    await expect(
      client.uploadFiles("image", [png(10 * 1024 * 1024)], { onUploadError }),
    ).rejects.toThrow("exceeds maximum size");
    expect(onUploadError).toHaveBeenCalledOnce();
    expect(calls.some((c) => c.pathname.endsWith("/init-upload"))).toBe(false);
    expect(MockXHR.instances).toHaveLength(0);
  });

  it("throws a clear version-skew error when the route-config lacks `files`", async () => {
    // An older server serving the pre-`files` payload must fail loud, not crash deep in
    // matching with an opaque TypeError.
    mockFetch({
      routeConfig: () =>
        jsonResponse({ isPublic: true, type: "image", usageContext: "test", maxFileSize: "4MB" }),
    });
    const client = makeClient();
    await expect(client.uploadFiles("image", [png()])).rejects.toThrow(
      /route-config response is missing `files`/,
    );
  });

  it("rejects when init fails; no PUT happens", async () => {
    mockFetch({ init: () => jsonResponse({ error: "nope" }, 400) });
    const onUploadError = vi.fn();
    const client = makeClient();
    await expect(client.uploadFiles("image", [png()], { onUploadError })).rejects.toThrow();
    expect(onUploadError).toHaveBeenCalledOnce();
    expect(MockXHR.instances).toHaveLength(0);
  });

  it("rejects when complete fails; onClientUploadComplete never fires", async () => {
    mockFetch({ complete: () => jsonResponse({ error: "bad token" }, 500) });
    const onUploadError = vi.fn();
    const onClientUploadComplete = vi.fn();
    const client = makeClient();
    const p = client.uploadFiles("image", [png()], { onUploadError, onClientUploadComplete });
    await waitForXhrs(1);
    MockXHR.instances[0]!.respond(200);
    await expect(p).rejects.toThrow();
    expect(onUploadError).toHaveBeenCalledOnce();
    expect(onClientUploadComplete).not.toHaveBeenCalled();
  });

  it("rejects an empty files array without invoking callbacks", async () => {
    mockFetch();
    const onUploadError = vi.fn();
    const client = makeClient();
    await expect(client.uploadFiles("image", [], { onUploadError })).rejects.toThrow(
      "No files provided.",
    );
    expect(onUploadError).not.toHaveBeenCalled();
  });
});

describe("uploadFiles — abort matrix", () => {
  it("pre-start abort: reports onUploadAborted once, never onUploadError, no init/PUT", async () => {
    const { calls } = mockFetch();
    const onUploadAborted = vi.fn();
    const onUploadError = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const client = makeClient();

    await expect(
      client.uploadFiles("image", [png()], {
        signal: controller.signal,
        onUploadAborted,
        onUploadError,
      }),
    ).rejects.toThrow("Upload aborted.");
    expect(onUploadAborted).toHaveBeenCalledOnce();
    expect(onUploadError).not.toHaveBeenCalled();
    expect(MockXHR.instances).toHaveLength(0);
    // A pre-aborted run must not create server-side state via init-upload.
    expect(calls.some((c) => c.pathname.endsWith("/init-upload"))).toBe(false);
    expect(calls.some((c) => c.pathname.endsWith("/complete-upload"))).toBe(false);
  });

  it("abort while the route-config load hangs: bails promptly, never sends init", async () => {
    // A route-config fetch that never resolves — the abort must not wait on it.
    const { calls } = mockFetch({ routeConfig: (() => new Promise<never>(() => {})) as any });
    const onUploadAborted = vi.fn();
    const onUploadError = vi.fn();
    const controller = new AbortController();
    const client = makeClient();

    const p = client.uploadFiles("image", [png()], {
      signal: controller.signal,
      onUploadAborted,
      onUploadError,
    });
    controller.abort();

    await expect(p).rejects.toThrow("Upload aborted.");
    expect(onUploadAborted).toHaveBeenCalledOnce();
    expect(onUploadError).not.toHaveBeenCalled();
    expect(calls.some((c) => c.pathname.endsWith("/init-upload"))).toBe(false);
  });

  it("mid-transfer abort: cancels the XHR, reports onUploadAborted once, no complete", async () => {
    const { calls } = mockFetch();
    const onUploadAborted = vi.fn();
    const onUploadError = vi.fn();
    const controller = new AbortController();
    const client = makeClient();

    const p = client.uploadFiles("image", [png()], {
      signal: controller.signal,
      onUploadAborted,
      onUploadError,
    });
    await waitForXhrs(1);
    controller.abort();

    await expect(p).rejects.toThrow("Upload aborted");
    expect(onUploadAborted).toHaveBeenCalledOnce();
    expect(onUploadError).not.toHaveBeenCalled();
    expect(MockXHR.instances[0]!.aborted).toBe(true);
    expect(calls.some((c) => c.pathname.endsWith("/complete-upload"))).toBe(false);
  });

  it("abort between the last PUT and completion: aborts, never fires onClientUploadComplete", async () => {
    const { calls } = mockFetch();
    const onUploadAborted = vi.fn();
    const onUploadError = vi.fn();
    const onClientUploadComplete = vi.fn();
    const controller = new AbortController();
    const client = makeClient();

    const p = client.uploadFiles("image", [png()], {
      signal: controller.signal,
      onUploadAborted,
      onUploadError,
      onClientUploadComplete,
    });
    await waitForXhrs(1);
    // Resolve the PUT, then abort in the same tick — before the orchestration
    // loop resumes. This is the window the abort listener still covers.
    MockXHR.instances[0]!.respond(200);
    controller.abort();

    await expect(p).rejects.toThrow("Upload aborted.");
    expect(onUploadAborted).toHaveBeenCalledOnce();
    expect(onClientUploadComplete).not.toHaveBeenCalled();
    expect(onUploadError).not.toHaveBeenCalled();
    expect(calls.some((c) => c.pathname.endsWith("/complete-upload"))).toBe(false);
  });

  it("abort after the transfer finished is ignored: completion proceeds", async () => {
    const controller = new AbortController();
    mockFetch({
      complete: () => {
        // Fire the abort while completion is in flight — the listener is
        // already removed, so this must not cancel the batch.
        controller.abort();
        return jsonResponse(testCompleteResult);
      },
    });
    const onUploadAborted = vi.fn();
    const onClientUploadComplete = vi.fn();
    const client = makeClient();

    const p = client.uploadFiles("image", [png()], {
      signal: controller.signal,
      onUploadAborted,
      onClientUploadComplete,
    });
    await waitForXhrs(1);
    MockXHR.instances[0]!.respond(200);

    await expect(p).resolves.toEqual(testCompleteResult);
    expect(onUploadAborted).not.toHaveBeenCalled();
    expect(onClientUploadComplete).toHaveBeenCalledOnce();
  });
});

describe("wire URLs (post-hono)", () => {
  it("builds default-base-path URLs", async () => {
    const { calls } = mockFetch();
    const p = makeClient().uploadFiles("image", [png()], {});
    await waitForXhrs(1);
    MockXHR.instances[0]!.respond(200);
    await p;
    expect(calls.map((c) => c.pathname)).toEqual([
      "/api/upload-stuff/image/route-config",
      "/api/upload-stuff/image/init-upload",
      "/api/upload-stuff/image/complete-upload",
    ]);
  });

  it("respects a custom basePath and a baseURL with a path", async () => {
    const { calls } = mockFetch();
    const client = createUploadStuffClient<any>({
      baseURL: "https://app.example.com/sub/",
      basePath: "/custom-base",
    });
    const p = client.uploadFiles("image", [png()], {});
    await waitForXhrs(1);
    MockXHR.instances[0]!.respond(200);
    await p;
    // absolute basePath replaces the baseURL path — same as the previous hc base
    expect(calls[0]!.pathname).toBe("/custom-base/image/route-config");
  });

  it("percent-encodes endpoint names", async () => {
    const { calls } = mockFetch();
    const p = makeClient().uploadFiles("a/b" as any, [png()], {});
    await waitForXhrs(1);
    MockXHR.instances[0]!.respond(200);
    await p;
    expect(calls[0]!.pathname).toBe("/api/upload-stuff/a%2Fb/route-config");
  });
});

describe("non-OK responses (post-hono)", () => {
  it("uses the { error } body as the message and attaches status/data", async () => {
    mockFetch({ init: () => jsonResponse({ error: "quota exceeded" }, 401) });
    const onUploadError = vi.fn();
    await expect(
      makeClient().uploadFiles("image", [png()], { onUploadError }),
    ).rejects.toMatchObject({ message: "quota exceeded", status: 401 });
    expect(onUploadError.mock.calls[0]![0]).toMatchObject({
      message: "quota exceeded",
      status: 401,
    });
  });

  it("falls back to body text, then to the status line", async () => {
    mockFetch({ init: () => new Response("plain failure", { status: 400 }) });
    await expect(makeClient().uploadFiles("image", [png()], {})).rejects.toMatchObject({
      message: "plain failure",
    });

    mockFetch({ init: () => new Response(null, { status: 400 }) });
    await expect(makeClient().uploadFiles("image", [png()], {})).rejects.toThrow(/^400/);
  });
});

describe("abort wiring (post-hono)", () => {
  it("passes the signal to init-upload but not to complete-upload", async () => {
    let initSignal: AbortSignal | undefined;
    let completeSignal: AbortSignal | undefined;
    mockFetch({
      init: (r) => {
        initSignal = r.signal;
        return jsonResponse(testUploadPlan);
      },
      complete: (r) => {
        completeSignal = r.signal;
        return jsonResponse(testCompleteResult);
      },
    });
    const controller = new AbortController();
    const done = makeClient().uploadFiles("image", [png()], { signal: controller.signal });
    await waitForXhrs(1);
    MockXHR.instances[0]!.respond(200);
    await done;
    // Aborting after completion: the init request carried the caller's signal
    // (goes aborted with it); the complete request must NOT have (stays fresh).
    controller.abort();
    expect(initSignal!.aborted).toBe(true);
    expect(completeSignal!.aborted).toBe(false);
  });

  it("treats completion errors as upload errors even if the caller aborts during completion", async () => {
    const controller = new AbortController();
    const onUploadAborted = vi.fn();
    const onUploadError = vi.fn();
    mockFetch({
      complete: () => {
        // Completion is already the source of truth. A late caller abort must
        // not mask a real complete-upload failure as "Upload aborted.".
        controller.abort();
        return jsonResponse({ error: "complete failed" }, 500);
      },
    });

    const p = makeClient().uploadFiles("image", [png()], {
      signal: controller.signal,
      onUploadAborted,
      onUploadError,
    });
    await waitForXhrs(1);
    MockXHR.instances[0]!.respond(200);

    await expect(p).rejects.toMatchObject({ message: "complete failed", status: 500 });
    expect(onUploadAborted).not.toHaveBeenCalled();
    expect(onUploadError.mock.calls[0]![0]).toMatchObject({
      message: "complete failed",
      status: 500,
    });
  });

  it("cancels a hung init-upload on abort and rejects with 'Upload aborted.'", async () => {
    const onUploadAborted = vi.fn();
    let initStarted!: () => void;
    const started = new Promise<void>((resolve) => (initStarted = resolve));
    mockFetch({
      init: (r) =>
        new Promise<Response>((_resolve, reject) => {
          initStarted();
          r.signal.addEventListener("abort", () => reject(new DOMException("x", "AbortError")));
        }),
    });
    const controller = new AbortController();
    const p = makeClient().uploadFiles("image", [png()], {
      signal: controller.signal,
      onUploadAborted,
    });
    const rejection = expect(p).rejects.toThrow("Upload aborted.");
    await started; // init fetch is in flight — now abort mid-request
    controller.abort();
    await rejection;
    expect(onUploadAborted).toHaveBeenCalledTimes(1);
  });
});

describe("getRouteConfig", () => {
  it("returns the route config", async () => {
    mockFetch();
    const client = makeClient();
    await expect(client.getRouteConfig("image")).resolves.toEqual(testRouteConfig);
  });

  it("caches per endpoint: concurrent and repeat calls share one fetch", async () => {
    const { calls } = mockFetch();
    const client = makeClient();
    await Promise.all([client.getRouteConfig("image"), client.getRouteConfig("image")]);
    await client.getRouteConfig("image");
    expect(calls.filter((c) => c.pathname.endsWith("/route-config"))).toHaveLength(1);

    await client.getRouteConfig("document");
    expect(calls.filter((c) => c.pathname.endsWith("/route-config"))).toHaveLength(2);
  });

  it("rejects on a non-OK response and retries on the next call", async () => {
    let n = 0;
    mockFetch({
      routeConfig: () =>
        n++ === 0 ? jsonResponse({ error: "boom" }, 500) : jsonResponse(testRouteConfig),
    });
    const client = makeClient();
    await expect(client.getRouteConfig("image")).rejects.toThrow();
    await expect(client.getRouteConfig("image")).resolves.toEqual(testRouteConfig);
  });

  it("force refetches even when a config is already cached", async () => {
    const { calls } = mockFetch();
    const client = makeClient();
    await client.getRouteConfig("image");
    await expect(client.getRouteConfig("image", { force: true })).resolves.toEqual(
      testRouteConfig,
    );
    expect(calls.filter((c) => c.pathname.endsWith("/route-config"))).toHaveLength(2);
  });

  it("force rides an in-flight fetch instead of starting a parallel one", async () => {
    const { calls } = mockFetch();
    const client = makeClient();
    // A forced refetch fired while the initial load is still in flight must
    // dedupe onto it, not open a second request.
    const [a, b] = await Promise.all([
      client.getRouteConfig("image"),
      client.getRouteConfig("image", { force: true }),
    ]);
    expect(a).toEqual(testRouteConfig);
    expect(b).toEqual(testRouteConfig);
    expect(calls.filter((c) => c.pathname.endsWith("/route-config"))).toHaveLength(1);
  });

  it("an overlapping forced refetch that fails never poisons the cache", async () => {
    let failing = true;
    mockFetch({
      routeConfig: () =>
        failing ? jsonResponse({ error: "boom" }, 500) : jsonResponse(testRouteConfig),
    });
    const client = makeClient();
    // Initial load + a forced refetch that rides it; both reject.
    await Promise.allSettled([
      client.getRouteConfig("image"),
      client.getRouteConfig("image", { force: true }),
    ]);
    // The cache must not be stuck on the rejection — the next call refetches.
    failing = false;
    await expect(client.getRouteConfig("image")).resolves.toEqual(testRouteConfig);
  });

  it("a failed forced refresh keeps the cached config for later callers", async () => {
    let n = 0;
    const { calls } = mockFetch({
      routeConfig: () =>
        n++ === 1 ? jsonResponse({ error: "boom" }, 500) : jsonResponse(testRouteConfig),
    });
    const client = makeClient();
    await client.getRouteConfig("image");
    await expect(client.getRouteConfig("image", { force: true })).rejects.toThrow();
    // Stale beats broken: the cached config still serves without a new fetch.
    await expect(client.getRouteConfig("image")).resolves.toEqual(testRouteConfig);
    expect(calls.filter((c) => c.pathname.endsWith("/route-config"))).toHaveLength(2);
  });

  it("uploadFiles shares the cache — no second config fetch", async () => {
    const { calls } = mockFetch();
    const client = makeClient();
    await client.getRouteConfig("image");
    const p = client.uploadFiles("image", [png()]);
    await waitForXhrs(1);
    MockXHR.instances[0]!.respond(200);
    await p;
    expect(calls.filter((c) => c.pathname.endsWith("/route-config"))).toHaveLength(1);
  });
});
