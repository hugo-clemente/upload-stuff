/* oxlint-disable @typescript-eslint/no-explicit-any */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import type { UploadStuffClient } from "@upload-stuff/client";

import { createUploadStuffReactHelpers } from "./index";

const routeConfig = { isPublic: true, type: "image", usageContext: "test", maxFileSize: "4MB" };
const completeResult = { files: [], serverData: null };

type PendingUpload = {
  endpoint: string;
  files: File[];
  options: any;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

// A fake engine: uploads stay pending until the test drives them, and the
// captured options let tests fire the engine's callbacks in the same order
// the real orchestration does (terminal callback before the promise settles).
const makeClient = () => {
  const uploads: PendingUpload[] = [];
  const mock = {
    getRouteConfig: vi.fn(async () => routeConfig),
    uploadFiles: vi.fn(
      (endpoint: string, files: File[], options: any) =>
        new Promise((resolve, reject) => {
          uploads.push({ endpoint, files, options, resolve, reject });
        }),
    ),
  };
  return { client: mock as unknown as UploadStuffClient<any>, mock, uploads };
};

const finishUpload = (u: PendingUpload, result: unknown = completeResult) => {
  u.options.onUploadProgress?.(100);
  u.options.onClientUploadComplete?.(result);
  u.resolve(result);
};

const failUpload = (u: PendingUpload, error = new Error("boom")) => {
  u.options.onUploadError?.(error);
  u.reject(error);
};

const abortUpload = (u: PendingUpload) => {
  u.options.onUploadAborted?.();
  u.reject(new Error("Upload aborted."));
};

const png = () => new File([new Uint8Array(10)], "a.png", { type: "image/png" });

describe("useUploadStuff", () => {
  it("loads the route config and derives accept", async () => {
    const { client } = makeClient();
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useUploadStuff("image"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.routeConfig).toEqual(routeConfig);
    expect(typeof result.current.accept).toBe("string");
  });

  it("tracks isUploading and progress across a run", async () => {
    const { client, uploads } = makeClient();
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useUploadStuff("image"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isUploading).toBe(false);
    expect(result.current.progress).toBe(0);

    let p: Promise<unknown> | undefined;
    act(() => {
      p = result.current.startUpload([png()]);
    });
    expect(result.current.isUploading).toBe(true);
    expect(result.current.progress).toBe(0);

    act(() => {
      uploads[0]!.options.onUploadProgress(40);
    });
    expect(result.current.progress).toBe(40);

    await act(async () => {
      finishUpload(uploads[0]!);
      await p;
    });
    expect(result.current.isUploading).toBe(false);
    expect(result.current.progress).toBe(100);
  });

  it("forwards input and merged headers; does not pass routeConfig through", async () => {
    const { client, uploads } = makeClient();
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() =>
      useUploadStuff("image", { headers: { "x-a": "hook", "x-b": "hook" } }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      // `as any`: StartUploadFn<any> deterministically resolves to its
      // no-input branch (TS collapses the tuple-wrapped any-check to the
      // `undefined`-input signature — see the StartUploadFn comment in
      // ./index.ts), so an actual input value only type-checks against a
      // concrete route. This test exercises the runtime forwarding, not
      // the arity typing (that's index.test-d.ts's job).
      void result.current
        .startUpload([png()], { caption: "hi" } as any, { headers: { "x-b": "call" } })
        .catch(() => {});
    });

    const u = uploads[0]!;
    expect(u.endpoint).toBe("image");
    expect(u.files).toHaveLength(1);
    expect(u.options.input).toEqual({ caption: "hi" });
    expect(u.options.headers).toEqual({ "x-a": "hook", "x-b": "call" });
    // Shared cache in the engine — the hook must NOT pass routeConfig through.
    expect(u.options.routeConfig).toBeUndefined();
  });

  it("returns the engine's result from startUpload", async () => {
    const { client, uploads } = makeClient();
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useUploadStuff("image"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let res: unknown;
    await act(async () => {
      const p = result.current.startUpload([png()]);
      finishUpload(uploads[0]!);
      res = await p;
    });
    expect(res).toEqual(completeResult);
  });

  it("a caller signal aborts the run's composed signal", async () => {
    const { client, uploads } = makeClient();
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const abortController = new AbortController();
    const { result } = renderHook(() => useUploadStuff("image"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      void result.current
        .startUpload([png()], undefined, { signal: abortController.signal })
        .catch(() => {});
    });
    expect(uploads[0]!.options.signal.aborted).toBe(false);
    abortController.abort();
    expect(uploads[0]!.options.signal.aborted).toBe(true);

    await act(async () => abortUpload(uploads[0]!));
    expect(result.current.isUploading).toBe(false);
  });

  it("abort() aborts the active run; a no-op when idle", async () => {
    const { client, uploads } = makeClient();
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useUploadStuff("image"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.abort());
    expect(result.current.isUploading).toBe(false);

    act(() => {
      void result.current.startUpload([png()]).catch(() => {});
    });
    act(() => result.current.abort());
    expect(uploads[0]!.options.signal.aborted).toBe(true);

    await act(async () => abortUpload(uploads[0]!));
    expect(result.current.isUploading).toBe(false);
  });

  it("rejects a second start while uploading (promise rejection, no sync throw)", async () => {
    const { client, uploads } = makeClient();
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useUploadStuff("image"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      void result.current.startUpload([png()]).catch(() => {});
    });
    await expect(result.current.startUpload([png()])).rejects.toThrow(
      "An upload is already in progress",
    );
    expect(uploads).toHaveLength(1);
  });

  it("a start() from onClientUploadComplete keeps the new run alive and abortable", async () => {
    const { client, uploads } = makeClient();
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    let second: Promise<unknown> | undefined;
    const { result } = renderHook(() =>
      useUploadStuff("image", {
        onClientUploadComplete: () => {
          if (!second) {
            second = result.current.startUpload([png()]);
            second.catch(() => {});
          }
        },
      }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let first: Promise<unknown> | undefined;
    act(() => {
      first = result.current.startUpload([png()]);
    });
    await act(async () => {
      finishUpload(uploads[0]!);
      await first;
    });

    // The old run's unwinding frames must not have stomped the new run.
    expect(result.current.isUploading).toBe(true);
    expect(uploads).toHaveLength(2);

    // abort() must control the NEW run.
    act(() => result.current.abort());
    expect(uploads[1]!.options.signal.aborted).toBe(true);
    expect(uploads[0]!.options.signal.aborted).toBe(false);

    await act(async () => abortUpload(uploads[1]!));
    await expect(second!).rejects.toThrow("Upload aborted");
    expect(result.current.isUploading).toBe(false);
  });

  it("a start() from onUploadError is not stomped by the failing run's finally", async () => {
    const { client, uploads } = makeClient();
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    let second: Promise<unknown> | undefined;
    const { result } = renderHook(() =>
      useUploadStuff("image", {
        onUploadError: () => {
          if (!second) {
            second = result.current.startUpload([png()]);
            second.catch(() => {});
          }
        },
      }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let first: Promise<unknown> | undefined;
    act(() => {
      first = result.current.startUpload([png()]);
      first.catch(() => {});
    });
    await act(async () => {
      failUpload(uploads[0]!);
      await first!.catch(() => {});
    });

    // The failed run's settle must not overwrite the new run's state.
    expect(result.current.isUploading).toBe(true);

    await act(async () => {
      finishUpload(uploads[1]!);
      await second;
    });
    expect(result.current.isUploading).toBe(false);
    await expect(second!).resolves.toEqual(completeResult);
  });

  it("a rejection that bypasses the callbacks still settles the hook", async () => {
    const { client, uploads } = makeClient();
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useUploadStuff("image"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let p: Promise<unknown> | undefined;
    act(() => {
      p = result.current.startUpload([png()]);
      p.catch(() => {});
    });
    await act(async () => {
      // e.g. the engine's empty-files rejection: no callback fires.
      uploads[0]!.reject(new Error("No files provided."));
      await p!.catch(() => {});
    });
    expect(result.current.isUploading).toBe(false);
  });

  it("resets to idle when the endpoint changes; the detached run can't touch state", async () => {
    const { client, uploads } = makeClient();
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const { result, rerender } = renderHook(({ ep }: { ep: string }) => useUploadStuff(ep), {
      initialProps: { ep: "image" },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      void result.current.startUpload([png()]).catch(() => {});
    });
    act(() => {
      uploads[0]!.options.onUploadProgress(30);
    });
    expect(result.current.isUploading).toBe(true);
    expect(result.current.progress).toBe(30);

    rerender({ ep: "document" });
    expect(result.current.isUploading).toBe(false);
    expect(result.current.progress).toBe(0);

    // The detached run's progress must not resurrect state on the new endpoint…
    act(() => {
      uploads[0]!.options.onUploadProgress(80);
    });
    expect(result.current.progress).toBe(0);
    // …and abort() must not reach it.
    act(() => result.current.abort());
    expect(uploads[0]!.options.signal.aborted).toBe(false);
  });

  it("switching back to an endpoint mid-run does not reattach the orphaned run", async () => {
    const { client, uploads } = makeClient();
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const { result, rerender } = renderHook(({ ep }: { ep: string }) => useUploadStuff(ep), {
      initialProps: { ep: "image" },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      void result.current.startUpload([png()]).catch(() => {});
    });
    rerender({ ep: "document" });
    rerender({ ep: "image" });
    expect(result.current.isUploading).toBe(false);

    // abort() must not reach the orphaned run…
    act(() => result.current.abort());
    expect(uploads[0]!.options.signal.aborted).toBe(false);

    // …and a new run can start against the same endpoint.
    act(() => {
      void result.current.startUpload([png()]).catch(() => {});
    });
    expect(uploads).toHaveLength(2);
    expect(result.current.isUploading).toBe(true);

    // The orphaned run's late completion must not stomp the new run's state.
    await act(async () => {
      finishUpload(uploads[0]!);
    });
    expect(result.current.isUploading).toBe(true);
    expect(result.current.progress).toBe(0);
  });

  it("resolves the (r) => r.route selector", async () => {
    const { client, uploads } = makeClient();
    const { useUploadStuff } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useUploadStuff((r: any) => r.image));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => {
      void result.current.startUpload([png()]).catch(() => {});
    });
    expect(uploads[0]!.endpoint).toBe("image");
  });
});

describe("useRouteConfig", () => {
  it("returns { data, error, isLoading }", async () => {
    const { client } = makeClient();
    const { useRouteConfig } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useRouteConfig("image"));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual(routeConfig));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it("surfaces a first-load error", async () => {
    const { client, mock } = makeClient();
    mock.getRouteConfig.mockRejectedValue(new Error("boom"));
    const { useRouteConfig } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useRouteConfig("image"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toEqual(expect.any(Error));
    expect(result.current.data).toBeUndefined();
  });

  it("refetch forces a fresh fetch and swaps in the new data", async () => {
    const { client, mock } = makeClient();
    const fresh = { ...routeConfig, maxFileSize: "8MB" };
    const { useRouteConfig } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useRouteConfig("image"));
    await waitFor(() => expect(result.current.data).toEqual(routeConfig));

    mock.getRouteConfig.mockResolvedValue(fresh);
    await act(async () => {
      result.current.refetch();
    });
    await waitFor(() => expect(result.current.data).toEqual(fresh));
    expect(mock.getRouteConfig).toHaveBeenCalledWith("image", { force: true });
  });

  it("a failed refetch keeps serving the cached config (stale beats broken)", async () => {
    const { client, mock } = makeClient();
    const { useRouteConfig } = createUploadStuffReactHelpers<any>(client);
    const { result } = renderHook(() => useRouteConfig("image"));
    await waitFor(() => expect(result.current.data).toEqual(routeConfig));

    mock.getRouteConfig.mockRejectedValue(new Error("refresh failed"));
    await act(async () => {
      result.current.refetch();
    });
    expect(result.current.data).toEqual(routeConfig);
    expect(result.current.error).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });
});
