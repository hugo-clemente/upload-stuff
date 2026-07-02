/* oxlint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vite-plus/test";

import { createRouteConfigCache } from "./route-config";

const config = { isPublic: true, type: "image", usageContext: "t", maxFileSize: "4MB" } as const;

// Manually-settled fetcher so tests control when the fetch resolves.
const deferredFetcher = () => {
  const pending: Array<{ resolve: (v: unknown) => void; reject: (e: Error) => void }> = [];
  const fetcher = vi.fn(
    () =>
      new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  return { fetcher: fetcher as any, pending };
};

describe("createRouteConfigCache", () => {
  it("starts loading-true before any subscribe, without fetching", () => {
    const { fetcher } = deferredFetcher();
    const handle = createRouteConfigCache(fetcher)("image");
    expect(handle.store.getSnapshot()).toEqual({ isLoading: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("getServerSnapshot matches a fresh store's snapshot", () => {
    const { fetcher } = deferredFetcher();
    const handle = createRouteConfigCache(fetcher)("image");
    expect(handle.store.getServerSnapshot()).toEqual(handle.store.getSnapshot());
  });

  it("first subscribe triggers one fetch shared by concurrent subscribers", async () => {
    const { fetcher, pending } = deferredFetcher();
    const handle = createRouteConfigCache(fetcher)("image");
    const a = vi.fn();
    const b = vi.fn();
    handle.store.subscribe(a);
    handle.store.subscribe(b);
    expect(fetcher).toHaveBeenCalledTimes(1);
    pending[0]!.resolve(config);
    await vi.waitFor(() => expect(a).toHaveBeenCalled());
    expect(b).toHaveBeenCalled();
    expect(handle.store.getSnapshot()).toEqual({ data: config, isLoading: false });
  });

  it("keeps the snapshot reference stable between transitions", async () => {
    const { fetcher, pending } = deferredFetcher();
    const handle = createRouteConfigCache(fetcher)("image");
    handle.store.subscribe(() => {});
    const before = handle.store.getSnapshot();
    expect(handle.store.getSnapshot()).toBe(before);
    pending[0]!.resolve(config);
    await vi.waitFor(() => expect(handle.store.getSnapshot()).not.toBe(before));
    expect(handle.store.getSnapshot()).toBe(handle.store.getSnapshot());
  });

  it("load() shares the in-flight fetch and resolves with the config", async () => {
    const { fetcher, pending } = deferredFetcher();
    const handle = createRouteConfigCache(fetcher)("image");
    const p1 = handle.load();
    const p2 = handle.load();
    expect(fetcher).toHaveBeenCalledTimes(1);
    pending[0]!.resolve(config);
    await expect(p1).resolves.toEqual(config);
    await expect(p2).resolves.toEqual(config);
  });

  it("load() resolves from cache after success without refetching", async () => {
    const { fetcher, pending } = deferredFetcher();
    const handle = createRouteConfigCache(fetcher)("image");
    const p = handle.load();
    pending[0]!.resolve(config);
    await p;
    await expect(handle.load()).resolves.toEqual(config);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("failure lands { error, isLoading: false }; a new subscribe retries", async () => {
    const { fetcher, pending } = deferredFetcher();
    const handle = createRouteConfigCache(fetcher)("image");
    handle.store.subscribe(() => {});
    pending[0]!.reject(new Error("boom"));
    await vi.waitFor(() =>
      expect(handle.store.getSnapshot()).toMatchObject({ isLoading: false, error: expect.any(Error) }),
    );
    handle.store.subscribe(() => {});
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(handle.store.getSnapshot()).toEqual({ isLoading: true });
  });

  it("load() retries when in the error state", async () => {
    const { fetcher, pending } = deferredFetcher();
    const handle = createRouteConfigCache(fetcher)("image");
    const p = handle.load();
    pending[0]!.reject(new Error("boom"));
    await expect(p).rejects.toThrow("boom");
    const p2 = handle.load();
    expect(fetcher).toHaveBeenCalledTimes(2);
    pending[1]!.resolve(config);
    await expect(p2).resolves.toEqual(config);
  });

  it("memoizes handles per endpoint key and isolates entries", async () => {
    const { fetcher, pending } = deferredFetcher();
    const cache = createRouteConfigCache(fetcher);
    expect(cache("image")).toBe(cache("image"));
    const image = cache("image");
    const doc = cache("document");
    image.store.subscribe(() => {});
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("image");
    pending[0]!.resolve(config);
    await vi.waitFor(() => expect(image.store.getSnapshot().data).toEqual(config));
    expect(doc.store.getSnapshot()).toEqual({ isLoading: true });
  });

  it("unsubscribe stops notifications", async () => {
    const { fetcher, pending } = deferredFetcher();
    const handle = createRouteConfigCache(fetcher)("image");
    const listener = vi.fn();
    handle.store.subscribe(listener)();
    pending[0]!.resolve(config);
    await handle.load();
    expect(listener).not.toHaveBeenCalled();
  });
});
