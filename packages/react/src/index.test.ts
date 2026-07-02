/* oxlint-disable @typescript-eslint/no-explicit-any */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import type { UploadStuffClient } from "@upload-stuff/client";

import { createUploadStuffReactHelpers } from "./index";

const routeConfig = {
  isPublic: true,
  type: "image",
  usageContext: "test",
  maxFileSize: "4MB",
};

const completeResult = { files: [], serverData: null };

const makeClient = (overrides: Record<string, unknown> = {}) =>
  ({
    fetchRouteConfig: vi.fn(async () => routeConfig),
    uploadFiles: vi.fn(async () => completeResult),
    ...overrides,
  }) as unknown as UploadStuffClient<any>;

const png = () => new File([new Uint8Array(10)], "a.png", { type: "image/png" });

// Each test uses a distinct endpoint name: SWR keys are cached per module, so
// reusing an endpoint would leak route-config state across tests.

describe("useUploadStuff", () => {
  it("loads route config and derives accept", async () => {
    const client = makeClient();
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useUploadStuff("ep-accept"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.routeConfig).toEqual(routeConfig);
    expect(typeof result.current.accept).toBe("string");
    expect(result.current.accept!.length).toBeGreaterThan(0);
  });

  it("guards against double-submit in the same tick", async () => {
    let resolveUpload!: (v: unknown) => void;
    const client = makeClient({
      uploadFiles: vi.fn(() => new Promise((r) => (resolveUpload = r))),
    });
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useUploadStuff("ep-guard"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let first!: Promise<unknown>;
    let secondError: Error | undefined;
    await act(async () => {
      first = result.current.startUpload([png()]);
      // Same tick: state hasn't re-rendered yet — the ref must catch this.
      await result.current.startUpload([png()]).catch((e: Error) => (secondError = e));
    });
    expect(secondError?.message).toBe("An upload is already in progress");

    await act(async () => {
      resolveUpload(completeResult);
      await first;
    });
    expect(result.current.isUploading).toBe(false);
  });

  it("tracks isUploading around the engine promise, including rejection", async () => {
    let rejectUpload!: (e: Error) => void;
    const client = makeClient({
      uploadFiles: vi.fn(() => new Promise((_, rej) => (rejectUpload = rej))),
    });
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useUploadStuff("ep-lifecycle"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let p!: Promise<unknown>;
    act(() => {
      p = result.current.startUpload([png()]);
      p.catch(() => {});
    });
    await waitFor(() => expect(result.current.isUploading).toBe(true));

    await act(async () => {
      rejectUpload(new Error("boom"));
      await p.catch(() => {});
    });
    expect(result.current.isUploading).toBe(false);
  });

  it("forwards routeConfig, merged headers and per-call signal to the engine", async () => {
    const uploadFiles = vi.fn(async () => completeResult);
    const client = makeClient({ uploadFiles });
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const controller = new AbortController();
    const { result } = renderHook(() =>
      useUploadStuff("ep-forward", { headers: { "x-a": "hook", "x-b": "hook" } }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.startUpload([png()], undefined, {
        headers: { "x-b": "call" },
        signal: controller.signal,
      });
    });

    const [endpoint, files, options] = uploadFiles.mock.calls[0]! as any[];
    expect(endpoint).toBe("ep-forward");
    expect(files).toHaveLength(1);
    expect(options.routeConfig).toEqual(routeConfig);
    expect(options.signal).toBe(controller.signal);
    // Per-call headers win over hook-level ones.
    expect(options.headers).toEqual({ "x-a": "hook", "x-b": "call" });
  });

  it("returns the engine's CompleteUploadResult from startUpload", async () => {
    const client = makeClient();
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useUploadStuff("ep-result"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let res: unknown;
    await act(async () => {
      res = await result.current.startUpload([png()]);
    });
    expect(res).toEqual(completeResult);
  });

  it("resolves the (r) => r.route selector", async () => {
    const uploadFiles = vi.fn(async () => completeResult);
    const client = makeClient({ uploadFiles });
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useUploadStuff((r: any) => r["ep-selector"]));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.startUpload([png()]);
    });
    const [selectorEndpoint] = uploadFiles.mock.calls[0]! as any[];
    expect(selectorEndpoint).toBe("ep-selector");
  });
});

describe("useRouteConfig", () => {
  it("exposes the fetched config through SWR", async () => {
    const client = makeClient();
    const { useRouteConfig } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useRouteConfig("ep-routeconfig"));
    await waitFor(() => expect(result.current.data).toEqual(routeConfig));
  });
});
