/* oxlint-disable @typescript-eslint/no-explicit-any */
import { expect, vi } from "vite-plus/test";

import { MockXHR } from "./mock-xhr";

// The server serves the NORMALIZED config (per-bucket sizes, resolved caps), which is
// exactly what the client validates and derives `accept` from.
export const testRouteConfig = {
  isPublic: true,
  usageContext: "test",
  files: { "image/*": { maxFileSize: "4MB" } },
  maxFileCount: 20,
};

export const testUploadPlan = {
  batchToken: "batch-token-1",
  files: [
    {
      id: "file-1",
      key: "k1",
      filename: "a.png",
      contentType: "image/png",
      size: 1000,
      uploadUrl: "https://storage.example.com/put/1",
      uploadHeaders: { "x-amz-meta-user": "u1" },
    },
  ],
};

export const testCompleteResult = {
  files: [
    {
      id: "file-1",
      key: "k1",
      filename: "a.png",
      contentType: "image/png",
      size: 1000,
      publicUrl: "https://cdn.example.com/k1",
    },
  ],
  serverData: { ok: true },
};

export const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

export const mockFetch = ({
  routeConfig = () => jsonResponse(testRouteConfig),
  init = () => jsonResponse(testUploadPlan),
  complete = () => jsonResponse(testCompleteResult),
}: Partial<
  Record<"routeConfig" | "init" | "complete", (req: Request) => Response | Promise<Response>>
> = {}) => {
  const calls: { pathname: string; request: Request }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, requestInit?: RequestInit) => {
    const request = new Request(input as any, requestInit);
    const { pathname } = new URL(request.url);
    calls.push({ pathname, request });
    if (pathname.endsWith("/route-config")) return routeConfig(request);
    if (pathname.endsWith("/init-upload")) return init(request);
    if (pathname.endsWith("/complete-upload")) return complete(request);
    throw new Error(`Unexpected fetch: ${pathname}`);
  });
  return { calls };
};

export const png = (size = 1000, name = "a.png") =>
  new File([new Uint8Array(size)], name, { type: "image/png" });

// Resolves once `count` XHRs exist — the PUT loop creates them asynchronously.
export const waitForXhrs = (count: number) =>
  vi.waitFor(() => expect(MockXHR.instances.length).toBeGreaterThanOrEqual(count));
