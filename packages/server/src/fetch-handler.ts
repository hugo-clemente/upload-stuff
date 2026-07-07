import { z } from "zod";

import {
  DEFAULT_BASE_PATH,
  UploadStuffError,
  completeUploadRequestSchema,
  initUploadRequestSchema,
  type FieldsDeclaration,
  type UploadStuffRouterWithContext,
  type ValidContextObject,
} from "@upload-stuff/core";

import { fileRouteHandlers } from "./router/handler";
import type { AnyUploadStuff, UploadStuff } from "./upload-stuff";

export interface UploadStuffHTTPHandlerConfig {
  basePath: string;
}

export type CreateUploadStuffHandlerOptions<
  TContext extends ValidContextObject,
  TFields extends FieldsDeclaration = Record<never, never>,
> = {
  fileRouter: UploadStuffRouterWithContext<TContext>;
  uploadStuff: UploadStuff<TFields>;
  config?: Partial<UploadStuffHTTPHandlerConfig>;
  createContext: (opts: { headers: Headers }) => Promise<TContext>;
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

const errorJson = (message: string, status: number) => json({ error: message }, status);

const notFound = () => new Response("404 Not Found", { status: 404 });

// Hono-compatible param decoding: decode when valid, keep the raw segment when
// the percent-encoding is malformed (instead of throwing).
const safeDecode = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

const readJson = async (request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> => {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
};

export const toFetchHandler = <
  TContext extends ValidContextObject,
  TFields extends FieldsDeclaration = Record<never, never>,
>({
  fileRouter,
  uploadStuff,
  config,
  createContext,
}: CreateUploadStuffHandlerOptions<TContext, TFields>) => {
  const rawBase = config?.basePath ?? DEFAULT_BASE_PATH;
  // "/api/upload-stuff" and "/api/upload-stuff/" are the same base; "/" stays "/".
  const basePath = rawBase.length > 1 && rawBase.endsWith("/") ? rawBase.slice(0, -1) : rawBase;

  const routeHandler = fileRouteHandlers({
    fileRouter,
    // Same erasure as toNextJsHandler: the internal server layer operates on
    // AnyUploadStuff; TS can't prove the assignment through the generic boundary.
    uploadStuff: uploadStuff as AnyUploadStuff,
  });

  const endpointSchema = z.literal(Object.keys(fileRouter));

  const handle = async (request: Request, method: string): Promise<Response> => {
    const { pathname } = new URL(request.url);

    let rest: string;
    if (basePath === "/") rest = pathname;
    else if (pathname === basePath) rest = "/";
    else if (pathname.startsWith(`${basePath}/`)) rest = pathname.slice(basePath.length);
    else return notFound();

    // Context runs for every base-path hit — including route misses and wrong
    // methods — exactly like the Hono middleware it replaces. Exceptions
    // propagate; the host runtime owns the 500.
    const ctx = await createContext({ headers: request.headers });

    // `rest` always starts with "/", so a route is exactly ["", endpoint, action].
    const segments = rest.split("/");
    if (segments.length !== 3 || segments[1] === "" || segments[2] === "") return notFound();
    const rawEndpoint = segments[1]!;
    const action = segments[2]!;

    const run = async (fn: () => unknown): Promise<Response> => {
      try {
        return json(await fn());
      } catch (error) {
        if (error instanceof UploadStuffError) return errorJson(error.message, error.status);
        throw error;
      }
    };

    const validateEndpoint = () => {
      const parsed = endpointSchema.safeParse(safeDecode(rawEndpoint));
      return parsed.success ? parsed.data : undefined;
    };

    if (action === "route-config" && method === "GET") {
      const endpoint = validateEndpoint();
      if (endpoint === undefined) return errorJson("Invalid endpoint", 400);
      return run(() => routeHandler.getConfig({ endpoint }));
    }

    // Body parse + shape validation run BEFORE endpoint validation — the
    // previous zValidator middleware ran before getEndpoint, and the tests pin
    // that observable order.
    if (action === "init-upload" && method === "POST") {
      const read = await readJson(request);
      if (!read.ok) return errorJson("Malformed JSON in request body", 400);
      const parsed = initUploadRequestSchema.safeParse(read.body);
      if (!parsed.success) return errorJson(z.prettifyError(parsed.error), 400);
      const endpoint = validateEndpoint();
      if (endpoint === undefined) return errorJson("Invalid endpoint", 400);
      return run(() => routeHandler.initUpload(endpoint, parsed.data, ctx));
    }

    if (action === "complete-upload" && method === "POST") {
      const read = await readJson(request);
      if (!read.ok) return errorJson("Malformed JSON in request body", 400);
      const parsed = completeUploadRequestSchema.safeParse(read.body);
      if (!parsed.success) return errorJson(z.prettifyError(parsed.error), 400);
      const endpoint = validateEndpoint();
      if (endpoint === undefined) return errorJson("Invalid endpoint", 400);
      return run(() => routeHandler.completeUpload(endpoint, parsed.data, ctx));
    }

    return notFound();
  };

  return async (request: Request): Promise<Response> => {
    if (request.method === "HEAD") {
      // Same route, same status/headers, empty body — matches Hono app.fetch.
      const response = await handle(request, "GET");
      return new Response(null, { status: response.status, headers: response.headers });
    }
    return handle(request, request.method);
  };
};
