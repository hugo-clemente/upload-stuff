/* oxlint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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
import { createUploadStuffClient } from "./client";

const makeClient = () => createUploadStuffClient<any>({ baseURL: "https://app.example.com" });

beforeEach(() => {
  MockXHR.reset();
  vi.stubGlobal("XMLHttpRequest", MockXHR);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const snapshots = (controller: { subscribe: (cb: () => void) => () => void; getSnapshot: () => any }) => {
  const seen: any[] = [];
  controller.subscribe(() => seen.push(controller.getSnapshot()));
  return seen;
};

describe("createUpload — state machine", () => {
  it("starts idle with progress 0; getServerSnapshot matches", () => {
    mockFetch();
    const upload = makeClient().createUpload("image");
    expect(upload.getSnapshot()).toEqual({ status: "idle", progressPercent: 0 });
    expect(upload.getServerSnapshot()).toEqual(upload.getSnapshot());
  });

  it("walks idle → uploading → success and stores the result", async () => {
    mockFetch();
    const upload = makeClient().createUpload("image");
    const seen = snapshots(upload);

    const p = upload.start([png()]);
    expect(upload.getSnapshot()).toMatchObject({ status: "uploading", progressPercent: 0 });
    await waitForXhrs(1);
    MockXHR.instances[0]!.respond(200);
    await expect(p).resolves.toEqual(testCompleteResult);

    expect(upload.getSnapshot()).toMatchObject({ status: "success", result: testCompleteResult });
    expect(seen.map((s) => s.status)).toContain("uploading");
    expect(seen.at(-1)!.status).toBe("success");
  });

  it("rejects a second start while uploading (promise rejection, no sync throw)", async () => {
    mockFetch();
    const upload = makeClient().createUpload("image");
    const p = upload.start([png()]);
    const second = upload.start([png()]);
    await expect(second).rejects.toThrow("An upload is already in progress");
    await waitForXhrs(1);
    MockXHR.instances[0]!.respond(200);
    await p;
  });

  it("can restart after success, resetting result and progress", async () => {
    mockFetch();
    const upload = makeClient().createUpload("image");
    const p1 = upload.start([png()]);
    await waitForXhrs(1);
    MockXHR.instances[0]!.respond(200);
    await p1;

    const p2 = upload.start([png()]);
    expect(upload.getSnapshot()).toEqual({ status: "uploading", progressPercent: 0 });
    await waitForXhrs(2);
    MockXHR.instances[1]!.respond(200);
    await p2;
    expect(upload.getSnapshot().status).toBe("success");
  });

  it("a failed run lands status error with the error, and can restart", async () => {
    mockFetch({ init: () => jsonResponse({ error: "nope" }, 400) });
    const upload = makeClient().createUpload("image");
    await expect(upload.start([png()])).rejects.toThrow();
    expect(upload.getSnapshot()).toMatchObject({ status: "error", error: expect.any(Error) });

    const p2 = upload.start([png()]);
    expect(upload.getSnapshot().status).toBe("uploading");
    await expect(p2).rejects.toThrow();
  });

  it("empty files reject and settle status error without invoking callbacks", async () => {
    mockFetch();
    const onUploadError = vi.fn();
    const upload = makeClient().createUpload("image");
    await expect(upload.start([], { onUploadError } as any)).rejects.toThrow("No files provided.");
    expect(upload.getSnapshot()).toMatchObject({ status: "error" });
    expect(onUploadError).not.toHaveBeenCalled();
  });
});

describe("createUpload — abort", () => {
  it("abort() mid-transfer cancels the XHR and lands status aborted", async () => {
    mockFetch();
    const onUploadAborted = vi.fn();
    const upload = makeClient().createUpload("image");
    const p = upload.start([png()], { onUploadAborted } as any);
    await waitForXhrs(1);
    upload.abort();
    await expect(p).rejects.toThrow("Upload aborted");
    expect(MockXHR.instances[0]!.aborted).toBe(true);
    expect(upload.getSnapshot().status).toBe("aborted");
    expect(onUploadAborted).toHaveBeenCalledTimes(1);
  });

  it("abort() after the transfer finished is ignored — completion proceeds to success", async () => {
    const upload = makeClient().createUpload("image");
    mockFetch({
      complete: () => {
        upload.abort();
        return jsonResponse(testCompleteResult);
      },
    });
    const onUploadAborted = vi.fn();
    const p = upload.start([png()], { onUploadAborted } as any);
    await waitForXhrs(1);
    MockXHR.instances[0]!.respond(200);
    await expect(p).resolves.toEqual(testCompleteResult);
    expect(upload.getSnapshot().status).toBe("success");
    expect(onUploadAborted).not.toHaveBeenCalled();
  });

  it("a caller signal behaves identically to abort()", async () => {
    mockFetch();
    const controller = new AbortController();
    const upload = makeClient().createUpload("image");
    const p = upload.start([png()], { signal: controller.signal } as any);
    await waitForXhrs(1);
    controller.abort();
    await expect(p).rejects.toThrow("Upload aborted");
    expect(upload.getSnapshot().status).toBe("aborted");
  });

  it("abort() when not uploading is a no-op", () => {
    mockFetch();
    const upload = makeClient().createUpload("image");
    upload.abort();
    expect(upload.getSnapshot()).toEqual({ status: "idle", progressPercent: 0 });
  });
});

describe("createUpload — progress and ordering", () => {
  it("progressPercent tracks reporting and coalesces duplicate values", async () => {
    mockFetch();
    const upload = makeClient().createUpload("image");
    const seen = snapshots(upload);
    const p = upload.start([png()], { uploadProgressGranularity: "all" } as any);
    await waitForXhrs(1);
    // Two identical loaded values → duplicate percent reports; only one snapshot.
    MockXHR.instances[0]!.emitProgress(500);
    MockXHR.instances[0]!.emitProgress(500);
    MockXHR.instances[0]!.respond(200);
    await p;
    const progressValues = seen.map((s) => s.progressPercent);
    expect(progressValues.filter((v) => v === 50)).toHaveLength(1);
    expect(upload.getSnapshot().progressPercent).toBe(100);
  });

  it("snapshot transitions before the corresponding callback fires", async () => {
    mockFetch();
    const upload = makeClient().createUpload("image");
    let statusInCallback: string | undefined;
    const p = upload.start([png()], {
      onClientUploadComplete: () => {
        statusInCallback = upload.getSnapshot().status;
      },
    } as any);
    await waitForXhrs(1);
    MockXHR.instances[0]!.respond(200);
    await p;
    expect(statusInCallback).toBe("success");
  });
});

describe("shared route-config cache", () => {
  it("uploadFiles and the routeConfig store share one config fetch", async () => {
    const { calls } = mockFetch();
    const client = makeClient();
    client.routeConfig("image").store.subscribe(() => {});
    await vi.waitFor(() =>
      expect(client.routeConfig("image").store.getSnapshot()).toMatchObject({ data: testRouteConfig }),
    );
    const p = client.uploadFiles("image", [png()]);
    await waitForXhrs(1);
    MockXHR.instances[0]!.respond(200);
    await p;
    expect(calls.filter((c) => c.pathname.endsWith("/route-config"))).toHaveLength(1);
  });

  it("the routeConfig option still skips the cache entirely", async () => {
    const { calls } = mockFetch();
    const client = makeClient();
    const p = client.uploadFiles("image", [png()], { routeConfig: testRouteConfig as any });
    await waitForXhrs(1);
    MockXHR.instances[0]!.respond(200);
    await p;
    expect(calls.some((c) => c.pathname.endsWith("/route-config"))).toBe(false);
  });
});

describe("createUpload — synchronous restart from terminal callbacks", () => {
  it("a start() from onClientUploadComplete keeps the new run alive and abortable", async () => {
    mockFetch();
    const upload = makeClient().createUpload("image");
    let second: Promise<unknown> | undefined;
    const first = upload.start([png()], {
      onClientUploadComplete: () => {
        second = upload.start([png()], { onUploadAborted: () => {} } as any);
        second.catch(() => {});
      },
    } as any);
    await waitForXhrs(1);
    MockXHR.instances[0]!.respond(200);
    await first;

    // The old run's unwinding frames must not have stomped the new run.
    expect(upload.getSnapshot().status).toBe("uploading");

    // abort() must still control the NEW run.
    await waitForXhrs(2);
    upload.abort();
    await expect(second!).rejects.toThrow("Upload aborted");
    expect(upload.getSnapshot().status).toBe("aborted");
    expect(MockXHR.instances[1]!.aborted).toBe(true);
  });

  it("a start() from onUploadError is not stomped by the failing run's catch", async () => {
    mockFetch({
      init: (() => {
        let n = 0;
        return () => (n++ === 0 ? jsonResponse({ error: "nope" }, 400) : jsonResponse(testUploadPlan));
      })(),
    });
    const upload = makeClient().createUpload("image");
    let second: Promise<unknown> | undefined;
    const first = upload.start([png()], {
      onUploadError: () => {
        second = upload.start([png()]);
        second.catch(() => {});
      },
    } as any);
    await expect(first).rejects.toThrow();

    // The failed run's safety-net catch must not overwrite the new run's status.
    expect(upload.getSnapshot().status).toBe("uploading");
    await waitForXhrs(1);
    MockXHR.instances[0]!.respond(200);
    await expect(second!).resolves.toEqual(testCompleteResult);
    expect(upload.getSnapshot().status).toBe("success");
  });
});
