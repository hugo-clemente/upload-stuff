import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { MockXHR } from "./test/mock-xhr";
import { uploadFileWithProgress } from "./upload";

const file = (size = 100, name = "a.png", type = "image/png") =>
  new File([new Uint8Array(size)], name, { type });

beforeEach(() => {
  MockXHR.reset();
  vi.stubGlobal("XMLHttpRequest", MockXHR);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadFileWithProgress", () => {
  it("PUTs the file with Content-Type and replayed signed headers, resolves on 2xx", async () => {
    const p = uploadFileWithProgress({
      uploadUrl: "https://storage.example.com/put/1",
      uploadHeaders: { "x-amz-meta-user": "u1" },
      contentType: "image/png",
      file: file(),
    });
    const xhr = MockXHR.instances[0]!;
    xhr.respond(200);
    await expect(p).resolves.toBeUndefined();
    expect(xhr.method).toBe("PUT");
    expect(xhr.url).toBe("https://storage.example.com/put/1");
    expect(xhr.requestHeaders["Content-Type"]).toBe("image/png");
    expect(xhr.requestHeaders["x-amz-meta-user"]).toBe("u1");
    expect(xhr.sentBody).toBeInstanceOf(File);
  });

  it("sends the provided Content-Type header verbatim (no file.type fallback)", async () => {
    // The server folds to a storage-safe value and returns it as plan.contentType; the PUT
    // must replay exactly that so the presigned signature matches.
    const p = uploadFileWithProgress({
      uploadUrl: "https://storage.example.com/put/1",
      contentType: "application/octet-stream",
      file: file(100, "raw.bin", ""),
    });
    MockXHR.instances[0]!.respond(200);
    await p;
    expect(MockXHR.instances[0]!.requestHeaders["Content-Type"]).toBe("application/octet-stream");
  });

  it("rejects with the status on non-2xx", async () => {
    const p = uploadFileWithProgress({ uploadUrl: "https://s/1", contentType: "image/png", file: file() });
    MockXHR.instances[0]!.respond(500);
    await expect(p).rejects.toThrow("Upload failed (500)");
  });

  it("rejects on network error", async () => {
    const p = uploadFileWithProgress({ uploadUrl: "https://s/1", contentType: "image/png", file: file() });
    MockXHR.instances[0]!.failNetwork();
    await expect(p).rejects.toThrow("Upload failed");
  });

  it("forwards absolute loaded bytes to onProgress", async () => {
    const onProgress = vi.fn();
    const p = uploadFileWithProgress({ uploadUrl: "https://s/1", contentType: "image/png", file: file(), onProgress });
    const xhr = MockXHR.instances[0]!;
    xhr.emitProgress(10);
    xhr.emitProgress(30);
    xhr.respond(200);
    await p;
    expect(onProgress.mock.calls.map(([b]) => b)).toEqual([10, 30]);
  });

  it("hands the xhr to onInitXhr before sending", async () => {
    const seen: unknown[] = [];
    const p = uploadFileWithProgress({
      uploadUrl: "https://s/1",
      contentType: "image/png",
      file: file(),
      onInitXhr: (xhr) => seen.push(xhr),
    });
    expect(seen).toEqual([MockXHR.instances[0]]);
    MockXHR.instances[0]!.respond(200);
    await p;
  });

  it("rejects immediately and never sends when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const p = uploadFileWithProgress({ uploadUrl: "https://s/1", contentType: "image/png", file: file(), signal: controller.signal });
    await expect(p).rejects.toThrow("Upload aborted");
    expect(MockXHR.instances[0]!.aborted).toBe(true);
    expect(MockXHR.instances[0]!.sentBody).toBeUndefined();
  });

  it("aborts the xhr and rejects when the signal fires mid-flight", async () => {
    const controller = new AbortController();
    const p = uploadFileWithProgress({ uploadUrl: "https://s/1", contentType: "image/png", file: file(), signal: controller.signal });
    controller.abort();
    await expect(p).rejects.toThrow("Upload aborted");
    expect(MockXHR.instances[0]!.aborted).toBe(true);
  });
});
