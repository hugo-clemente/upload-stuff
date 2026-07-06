import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { toNodeHandler, type NodeRequestLike } from "./node";
import { fakeDatabaseAdapter, fakeStorageAdapter, makeRoute } from "./test/fakes";
import { UploadStuff } from "./upload-stuff";

const makeHandler = () =>
  toNodeHandler({
    fileRouter: { avatars: makeRoute(() => ({})) },
    uploadStuff: UploadStuff()({
      storageAdapter: () => fakeStorageAdapter(),
      databaseAdapter: () => fakeDatabaseAdapter(),
      filePublicUrlGenerator: ({ key }) => `https://cdn.test/${key}`,
    }),
    createContext: async () => ({ userId: "u1" }),
  });

const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

const listen = (
  wrap?: (
    handler: ReturnType<typeof makeHandler>,
  ) => (req: IncomingMessage, res: ServerResponse) => void,
) =>
  new Promise<string>((resolve) => {
    const handler = makeHandler();
    const server = createServer(
      wrap ? wrap(handler) : (req, res) => void handler(req, res),
    );
    closers.push(() => new Promise((r) => server.close(r)));
    server.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });

const validInit = JSON.stringify({
  files: [{ filename: "a.png", contentType: "image/png", size: 1024 }],
  input: null,
});

describe("toNodeHandler over a real http server", () => {
  it("serves route-config, init and complete round-trip", async () => {
    const url = await listen();
    const cfg = await fetch(`${url}/api/upload-stuff/avatars/route-config`);
    expect(cfg.status).toBe(200);
    expect(cfg.headers.get("content-type")).toContain("json");
    expect(await cfg.json()).toMatchObject({ usageContext: "avatars" });

    const init = await fetch(`${url}/api/upload-stuff/avatars/init-upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: validInit,
    });
    expect(init.status).toBe(200);
    const plan = await init.json();

    const complete = await fetch(`${url}/api/upload-stuff/avatars/complete-upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ batchToken: plan.batchToken }),
    });
    expect(complete.status).toBe(200);
    expect((await complete.json()).files).toHaveLength(1);
  });

  it("uses originalUrl when a mount stripped the prefix (Express/Nest style)", async () => {
    const url = await listen((handler) => (req, res) => {
      // Simulate app.use("/api/upload-stuff", h): Express strips the mount
      // path from req.url and keeps the full path on originalUrl.
      const stripped = req.url!.replace(/^\/api\/upload-stuff/, "") || "/";
      (req as NodeRequestLike).originalUrl = req.url!;
      req.url = stripped;
      void handler(req, res);
    });
    const res = await fetch(`${url}/api/upload-stuff/avatars/route-config`);
    expect(res.status).toBe(200);
  });

  it("uses a pre-parsed req.body when an upstream parser consumed the stream", async () => {
    const bodies: unknown[] = [JSON.parse(validInit), validInit, Buffer.from(validInit), null];
    for (const body of bodies) {
      const url = await listen((handler) => (req, res) => {
        // Simulate express.json(): drain the stream, expose req.body.
        req.resume();
        req.on("end", () => {
          (req as NodeRequestLike).body = body;
          void handler(req, res);
        });
      });
      const res = await fetch(`${url}/api/upload-stuff/avatars/init-upload`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: validInit,
      });
      // null body → malformed JSON 400; the other three parse as validInit.
      expect(res.status).toBe(body === null ? 400 : 200);
    }
  });

  it("attaches no body on GET or HEAD so route-config works behind parsers", async () => {
    const url = await listen((handler) => (req, res) => {
      (req as NodeRequestLike).body = { sneaky: true };
      void handler(req, res);
    });
    const get = await fetch(`${url}/api/upload-stuff/avatars/route-config`);
    expect(get.status).toBe(200);

    const head = await fetch(`${url}/api/upload-stuff/avatars/route-config`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("preserves status and content-type on errors", async () => {
    const url = await listen();
    const res = await fetch(`${url}/api/upload-stuff/nope/route-config`);
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("json");
    expect(await res.json()).toEqual({ error: "Invalid endpoint" });
  });
});
