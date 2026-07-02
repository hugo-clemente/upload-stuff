/* oxlint-disable @typescript-eslint/no-explicit-any */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import type { UploadStuffClient } from "@upload-stuff/client";

import { createUploadStuffReactHelpers } from "./index";

const routeConfig = { isPublic: true, type: "image", usageContext: "test", maxFileSize: "4MB" };
const completeResult = { files: [], serverData: null };

const fakeStore = <S,>(initial: S) => {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    set: (next: S) => {
      snapshot = next;
      listeners.forEach((l) => l());
    },
  };
};

const fakeHandle = () => {
  const store = fakeStore<{ data?: typeof routeConfig; error?: Error; isLoading: boolean }>({
    isLoading: true,
  });
  return {
    store,
    load: vi.fn(async () => {
      store.set({ data: routeConfig, isLoading: false });
      return routeConfig;
    }),
    // subscribe-triggered load, like the real handle
    handle: {
      load: undefined as any,
      store: {
        ...store,
        subscribe: (l: () => void) => {
          if (!store.getSnapshot().data) {
            store.set({ data: routeConfig, isLoading: false });
          }
          return store.subscribe(l);
        },
      },
    },
  };
};

const fakeController = () => {
  const store = fakeStore<{ status: string; progressPercent: number; result?: unknown; error?: Error }>(
    { status: "idle", progressPercent: 0 },
  );
  const start = vi.fn(async () => {
    store.set({ status: "uploading", progressPercent: 0 });
    return completeResult;
  });
  return { store, start, abort: vi.fn(), controller: { ...store, start, abort: vi.fn() } };
};

const makeClient = () => {
  const controllers = new Map<string, ReturnType<typeof fakeController>>();
  const handles = new Map<string, ReturnType<typeof fakeHandle>>();
  const client = {
    routeConfig: vi.fn((endpoint: string) => {
      if (!handles.has(endpoint)) {
        const h = fakeHandle();
        h.handle.load = h.load;
        handles.set(endpoint, h);
      }
      return handles.get(endpoint)!.handle;
    }),
    createUpload: vi.fn((endpoint: string) => {
      const c = fakeController();
      controllers.set(endpoint, c);
      return c.controller;
    }),
    fetchRouteConfig: vi.fn(async () => routeConfig),
    uploadFiles: vi.fn(async () => completeResult),
  };
  return { client: client as unknown as UploadStuffClient<any>, controllers, handles };
};

const png = () => new File([new Uint8Array(10)], "a.png", { type: "image/png" });

describe("useUploadStuff", () => {
  it("loads route config through the handle store and derives accept", async () => {
    const { client } = makeClient();
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useUploadStuff("image"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.routeConfig).toEqual(routeConfig);
    expect(typeof result.current.accept).toBe("string");
  });

  it("derives isUploading and progress from the controller snapshot", async () => {
    const { client, controllers } = makeClient();
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useUploadStuff("image"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isUploading).toBe(false);
    expect(result.current.progress).toBe(0);

    act(() => {
      controllers.get("image")!.store.set({ status: "uploading", progressPercent: 40 });
    });
    expect(result.current.isUploading).toBe(true);
    expect(result.current.progress).toBe(40);

    act(() => {
      controllers.get("image")!.store.set({ status: "success", progressPercent: 100 });
    });
    expect(result.current.isUploading).toBe(false);
    expect(result.current.progress).toBe(100);
  });

  it("startUpload forwards merged headers, per-call signal and input to controller.start", async () => {
    const { client, controllers } = makeClient();
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const abortController = new AbortController();
    const { result } = renderHook(() =>
      useUploadStuff("image", { headers: { "x-a": "hook", "x-b": "hook" } }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      // `as any`: StartUploadFn<any> deterministically resolves to its
      // no-input branch (TS collapses the tuple-wrapped any-check to the
      // `undefined`-input signature — see the StartUploadFn comment in
      // ./index.ts), so an actual input value only type-checks against a
      // concrete route. This test exercises the runtime forwarding, not
      // the arity typing (that's index.test-d.ts's job).
      await result.current.startUpload([png()], { caption: "hi" } as any, {
        headers: { "x-b": "call" },
        signal: abortController.signal,
      });
    });

    const start = controllers.get("image")!.start;
    const [files, options] = start.mock.calls[0]! as any[];
    expect(files).toHaveLength(1);
    expect(options.input).toEqual({ caption: "hi" });
    expect(options.signal).toBe(abortController.signal);
    expect(options.headers).toEqual({ "x-a": "hook", "x-b": "call" });
    // Shared cache in the engine — the hook must NOT pass routeConfig through.
    expect(options.routeConfig).toBeUndefined();
  });

  it("returns the controller's result from startUpload", async () => {
    const { client } = makeClient();
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useUploadStuff("image"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    let res: unknown;
    await act(async () => {
      res = await result.current.startUpload([png()]);
    });
    expect(res).toEqual(completeResult);
  });

  it("exposes the controller's abort", async () => {
    const { client, controllers } = makeClient();
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useUploadStuff("image"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => {
      result.current.abort();
    });
    expect(controllers.get("image")!.controller.abort).toHaveBeenCalledTimes(1);
  });

  it("rebinds to a fresh controller when the endpoint changes", async () => {
    const { client, controllers } = makeClient();
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const { result, rerender } = renderHook(({ ep }: { ep: string }) => useUploadStuff(ep), {
      initialProps: { ep: "image" },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      controllers.get("image")!.store.set({ status: "uploading", progressPercent: 10 });
    });
    expect(result.current.isUploading).toBe(true);

    rerender({ ep: "document" });
    // Fresh controller: the old run's state is detached from the hook.
    await waitFor(() => expect(result.current.isUploading).toBe(false));
    expect(client.createUpload).toHaveBeenCalledWith("document");
  });

  it("resolves the (r) => r.route selector", async () => {
    const { client } = makeClient();
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useUploadStuff((r: any) => r.image));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(client.createUpload).toHaveBeenCalledWith("image");
  });
});

describe("useRouteConfig", () => {
  it("returns { data, error, isLoading } from the handle store", async () => {
    const { client } = makeClient();
    const { useRouteConfig } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useRouteConfig("image"));
    await waitFor(() => expect(result.current.data).toEqual(routeConfig));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it("exposes refetch, which calls the handle's load", async () => {
    const { client, handles } = makeClient();
    const { useRouteConfig } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useRouteConfig("image"));
    await waitFor(() => expect(result.current.data).toBeDefined());
    act(() => {
      result.current.refetch();
    });
    expect(handles.get("image")!.load).toHaveBeenCalled();
  });
});
