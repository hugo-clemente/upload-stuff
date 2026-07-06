import type { IncomingMessage, ServerResponse } from "node:http";
import type { TLSSocket } from "node:tls";

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
  let url: string;
  if (/^https?:\/\//i.test(raw)) {
    url = raw;
  } else {
    const forwarded = req.headers["x-forwarded-proto"];
    const proto =
      (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : undefined) ??
      ((req.socket as TLSSocket).encrypted ? "https" : "http");
    // The fetch handler only reads pathname + headers; a fallback host keeps
    // URL parsing valid when the client sent none.
    const host = req.headers.host ?? "localhost";
    url = `${proto}://${host}${raw}`;
  }

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
  TFileUsageContext extends string,
  TFields extends FieldsDeclaration = Record<never, never>,
>(
  options: CreateUploadStuffHandlerOptions<TContext, TFileUsageContext, TFields>,
) => {
  const handler = toFetchHandler(options);

  return async (req: NodeRequestLike, res: ServerResponse): Promise<void> => {
    const response = await handler(await toRequest(req));

    res.statusCode = response.status;
    const setCookie = response.headers.getSetCookie?.() ?? [];
    response.headers.forEach((value, key) => {
      if (key !== "set-cookie") res.setHeader(key, value);
    });
    if (setCookie.length > 0) res.setHeader("set-cookie", setCookie);

    if (response.body) res.end(Buffer.from(await response.arrayBuffer()));
    else res.end();
  };
};
