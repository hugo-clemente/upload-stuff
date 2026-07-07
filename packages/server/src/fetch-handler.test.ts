import { describe, expect, it, vi } from "vite-plus/test";

import { UploadStuffError } from "@upload-stuff/core";

import { toFetchHandler, type UploadStuffHTTPHandlerConfig } from "./fetch-handler";
import { fakeDatabaseAdapter, fakeStorageAdapter, makeRoute } from "./test/fakes";
import { UploadStuff } from "./upload-stuff";

const makeUploadStuff = () =>
  UploadStuff({
    storageAdapter: () => fakeStorageAdapter(),
    databaseAdapter: () => fakeDatabaseAdapter(),
    filePublicUrlGenerator: ({ key }) => `https://cdn.test/${key}`,
  });

const setup = (opts?: {
  config?: Partial<UploadStuffHTTPHandlerConfig>;
  routeNames?: string[];
  middleware?: () => object;
  createContext?: (o: { headers: Headers }) => Promise<{ userId: string }>;
}) => {
  const names = opts?.routeNames ?? ["avatars"];
  const fileRouter = Object.fromEntries(
    names.map((n) => [
      n,
      opts?.middleware
        ? { ...makeRoute(() => ({})), middleware: opts.middleware }
        : makeRoute(() => ({})),
    ]),
  ) as Record<string, ReturnType<typeof makeRoute>>;
  const createContext = vi.fn(opts?.createContext ?? (async () => ({ userId: "u1" })));
  const handler = toFetchHandler({
    fileRouter,
    uploadStuff: makeUploadStuff(),
    config: opts?.config,
    createContext,
  });
  return { handler, createContext };
};

const req = (path: string, init?: RequestInit) =>
  new Request(`https://test.local${path}`, init);

const post = (path: string, body: unknown) =>
  req(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const validInit = {
  files: [{ filename: "a.png", contentType: "image/png", size: 1024 }],
  input: null,
};

describe("base path matching", () => {
  it("serves route-config under the default base path", async () => {
    const { handler } = setup();
    const res = await handler(req("/api/upload-stuff/avatars/route-config"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const deletedKey = ["usage", "Context"].join("");
    expect(body).not.toHaveProperty(deletedKey);
  });

  it("treats a trailing-slash basePath config as the same base", async () => {
    const { handler } = setup({ config: { basePath: "/api/upload-stuff/" } });
    const res = await handler(req("/api/upload-stuff/avatars/route-config"));
    expect(res.status).toBe(200);
  });

  it("supports root basePath '/'", async () => {
    const { handler } = setup({ config: { basePath: "/" } });
    const res = await handler(req("/avatars/route-config"));
    expect(res.status).toBe(200);
  });

  it("ignores query strings", async () => {
    const { handler } = setup();
    const res = await handler(req("/api/upload-stuff/avatars/route-config?x=1"));
    expect(res.status).toBe(200);
  });

  it("404s on a segment-boundary mismatch without calling createContext", async () => {
    const { handler, createContext } = setup();
    const res = await handler(req("/api/upload-stufffoo/avatars/route-config"));
    expect(res.status).toBe(404);
    expect(createContext).not.toHaveBeenCalled();
  });

  it("404s a route miss under the base path but still calls createContext", async () => {
    const { handler, createContext } = setup();
    const res = await handler(req("/api/upload-stuff/some/unknown/path"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("404 Not Found");
    expect(createContext).toHaveBeenCalledTimes(1);
  });

  it("rejects a trailing slash after the route path", async () => {
    const { handler } = setup();
    const res = await handler(req("/api/upload-stuff/avatars/route-config/"));
    expect(res.status).toBe(404);
  });
});

describe("endpoint segment decoding", () => {
  it("decodes %20 in the endpoint segment", async () => {
    const { handler } = setup({ routeNames: ["has space"] });
    const res = await handler(req("/api/upload-stuff/has%20space/route-config"));
    expect(res.status).toBe(200);
  });

  it("decodes %2F to a literal slash inside one segment", async () => {
    const { handler } = setup({ routeNames: ["a/b"] });
    const res = await handler(req("/api/upload-stuff/a%2Fb/route-config"));
    expect(res.status).toBe(200);
  });

  it("does not double-decode %252F", async () => {
    const { handler } = setup({ routeNames: ["a/b"] });
    const res = await handler(req("/api/upload-stuff/a%252Fb/route-config"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid endpoint" });
  });

  it("keeps a malformed percent-encoded segment raw instead of throwing", async () => {
    const { handler } = setup();
    const res = await handler(req("/api/upload-stuff/%E0%A4%A/route-config"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid endpoint" });
  });
});

describe("methods", () => {
  it("HEAD on route-config returns the GET status/headers with an empty body", async () => {
    const { handler } = setup();
    const res = await handler(req("/api/upload-stuff/avatars/route-config", { method: "HEAD" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("json");
    expect(await res.text()).toBe("");
  });

  it("404s wrong methods (POST route-config, GET init-upload) after createContext", async () => {
    const { handler, createContext } = setup();
    expect((await handler(post("/api/upload-stuff/avatars/route-config", {}))).status).toBe(404);
    expect((await handler(req("/api/upload-stuff/avatars/init-upload"))).status).toBe(404);
    expect(createContext).toHaveBeenCalledTimes(2);
  });
});

describe("validation order (parity with zValidator-before-getEndpoint)", () => {
  it("malformed JSON on an unknown endpoint reports the body error, not the endpoint", async () => {
    const { handler } = setup();
    const res = await handler(post("/api/upload-stuff/nope/init-upload", "{not json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Malformed JSON in request body" });
  });

  it("schema-invalid body on an unknown endpoint reports the shape error, not the endpoint", async () => {
    const { handler } = setup();
    const res = await handler(post("/api/upload-stuff/nope/init-upload", { files: {} }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).not.toBe("Invalid endpoint");
    expect(typeof body.error).toBe("string");
  });

  it("valid body on an unknown endpoint reports Invalid endpoint", async () => {
    const { handler } = setup();
    const res = await handler(post("/api/upload-stuff/nope/init-upload", validInit));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid endpoint" });
  });
});

describe("error mapping and happy path", () => {
  it("maps UploadStuffError to its status with an { error } envelope", async () => {
    const { handler } = setup({
      middleware: () => {
        throw new UploadStuffError({ code: "UNAUTHORIZED", message: "nope" });
      },
    });
    const res = await handler(post("/api/upload-stuff/avatars/init-upload", validInit));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "nope" });
  });

  it("lets unknown exceptions propagate (host turns them into 500)", async () => {
    const { handler } = setup({
      middleware: () => {
        throw new Error("boom");
      },
    });
    await expect(handler(post("/api/upload-stuff/avatars/init-upload", validInit))).rejects.toThrow(
      "boom",
    );
  });

  it("lets createContext exceptions propagate", async () => {
    const { handler } = setup({
      createContext: async () => {
        throw new Error("ctx boom");
      },
    });
    await expect(handler(req("/api/upload-stuff/avatars/route-config"))).rejects.toThrow("ctx boom");
  });

  it("runs init then complete end-to-end over HTTP", async () => {
    const { handler } = setup();
    const initRes = await handler(post("/api/upload-stuff/avatars/init-upload", validInit));
    expect(initRes.status).toBe(200);
    const plan = await initRes.json();
    expect(plan.batchToken).toBeTruthy();
    expect(plan.files).toHaveLength(1);

    const completeRes = await handler(
      post("/api/upload-stuff/avatars/complete-upload", { batchToken: plan.batchToken }),
    );
    expect(completeRes.status).toBe(200);
    expect((await completeRes.json()).files).toHaveLength(1);
  });
});
