import type { IncomingMessage, ServerResponse } from "node:http";

import type { FieldsDeclaration, ValidContextObject } from "@upload-stuff/core";

import { toFetchHandler, type CreateUploadStuffHandlerOptions } from "./fetch-handler";

export type NodeRequestLike = IncomingMessage & {
  /** Express/Nest keep the unstripped path here when the handler is mounted under a prefix. */
  originalUrl?: string;
  /** Populated when an upstream body parser (express.json, Nest's default) consumed the stream. */
  body?: unknown;
};

const readBody = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    // An upstream parser that consumed the stream without exposing req.body
    // leaves it ended; reading here would hang waiting for an "end" that fired.
    if (req.readableEnded) return resolve(Buffer.alloc(0));
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

const requestBody = async (req: NodeRequestLike, method: string): Promise<BodyInit | undefined> => {
  if (method === "GET" || method === "HEAD") return undefined;
  if (req.body !== undefined) {
    // An upstream parser already consumed the stream — reuse what it exposed.
    if (typeof req.body === "string") return req.body;
    if (req.body instanceof Uint8Array) return req.body as BodyInit; // Buffer included
    return JSON.stringify(req.body); // object or null
  }
  // Buffered on purpose: this control plane only ever carries small JSON —
  // file bytes go browser -> storage and never pass through here.
  return (await readBody(req)) as BodyInit;
};

const toRequest = async (req: NodeRequestLike): Promise<Request> => {
  const raw = req.originalUrl ?? req.url ?? "/";
  // The fetch handler routes on pathname + headers only and never reads the
  // origin, so a fixed synthetic origin is enough — and drops the untrusted
  // Host/x-forwarded-proto the old code interpolated. Concatenate rather than
  // `new URL(raw, base)`: the two-arg form resolves `raw` relatively, so a
  // `//authority/...` target would be parsed as protocol-relative and reroute
  // to a real endpoint. Concatenation keeps a leading `//` in the path (a 404),
  // matching the previous handler.
  const url = /^https?:\/\//i.test(raw) ? raw : `http://localhost${raw}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else headers.set(key, value);
  }

  const method = req.method ?? "GET";
  return new Request(url, { method, headers, body: await requestBody(req, method) });
};

export const toNodeHandler = <
  TContext extends ValidContextObject,
  TFields extends FieldsDeclaration = Record<never, never>,
>(
  options: CreateUploadStuffHandlerOptions<TContext, TFields>,
) => {
  const handler = toFetchHandler(options);

  // `next` is the Express/Nest middleware error callback; it's absent for raw
  // `node:http`. Forwarding to it when present lets the framework's error
  // pipeline (logging, exception filters) see user-code failures; without it we
  // answer the 500 ourselves so a bare-Node rejection can't crash the process.
  return async (
    req: NodeRequestLike,
    res: ServerResponse,
    next?: (err?: unknown) => void,
  ): Promise<void> => {
    try {
      const response = await handler(await toRequest(req));

      res.statusCode = response.status;
      const setCookie = response.headers.getSetCookie?.() ?? [];
      response.headers.forEach((value, key) => {
        if (key !== "set-cookie") res.setHeader(key, value);
      });
      if (setCookie.length > 0) res.setHeader("set-cookie", setCookie);

      if (response.body) res.end(Buffer.from(await response.arrayBuffer()));
      else res.end();
    } catch (err) {
      if (next) return next(err);
      if (res.headersSent) return void res.destroy(err instanceof Error ? err : undefined);
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "Internal Server Error" }));
    }
  };
};
