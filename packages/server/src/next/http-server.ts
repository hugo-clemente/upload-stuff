import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { Hono } from "hono";
import { z } from "zod";

import {
  DEFAULT_BASE_PATH,
  UploadStuffError,
  initUploadFileSchema,
  type UploadStuffRouter,
  type ValidContextObject,
} from "@upload-stuff/core";

import { fileRouteHandlers } from "../router/handler";
import type { AnyUploadStuff } from "../upload-stuff";

const handleError = (c: Context, error: unknown) => {
  if (error instanceof UploadStuffError) {
    return c.json({ error: error.message }, error.status);
  }
  throw error;
};

const respond = async <T>(c: Context, fn: () => T | Promise<T>) => {
  try {
    return c.json(await fn());
  } catch (error) {
    return handleError(c, error);
  }
};

export interface UploadStuffHTTPServerConfig {
  basePath: string;
}

const defaultConfig: UploadStuffHTTPServerConfig = {
  basePath: DEFAULT_BASE_PATH,
};

const initUploadHandlerSchema = z.object({
  files: z.array(initUploadFileSchema),
  input: z.json(),
});

const completeUploadHandlerSchema = z.object({
  batchToken: z.string(),
});

const createRoutes = ({
  fileRouter,
  uploadStuff,
  createContext,
}: {
  fileRouter: UploadStuffRouter;
  uploadStuff: AnyUploadStuff;
  createContext: (opts: { headers: Headers }) => Promise<ValidContextObject>;
}) => {
  const fileRoutes = Object.keys(fileRouter) as (keyof typeof fileRouter)[];
  const endpointSchema = z.literal(fileRoutes);

  const getEndpoint = (c: Context) => {
    const endpoint = c.req.param("endpoint");
    const parsedBody = endpointSchema.safeParse(endpoint);
    if (!parsedBody.success) {
      throw new HTTPException(400, { message: "Invalid endpoint" });
    }
    return parsedBody.data;
  };

  const routeHandler = fileRouteHandlers({
    fileRouter: fileRouter,
    uploadStuff,
  });

  const createContextMiddleware = createMiddleware<{
    Variables: {
      ctx: ValidContextObject;
    };
  }>(async (c, next) => {
    const context = await createContext({ headers: c.req.raw.headers });
    c.set("ctx", context);
    return next();
  });

  const route = new Hono()
    .use(createContextMiddleware)
    .get("/:endpoint/route-config", (c) =>
      respond(c, () => routeHandler.getConfig({ endpoint: getEndpoint(c) })),
    )
    .post("/:endpoint/init-upload", zValidator("json", initUploadHandlerSchema), (c) =>
      respond(c, () => routeHandler.initUpload(getEndpoint(c), c.req.valid("json"), c.get("ctx"))),
    )
    .post("/:endpoint/complete-upload", zValidator("json", completeUploadHandlerSchema), (c) =>
      respond(c, () =>
        routeHandler.completeUpload(getEndpoint(c), c.req.valid("json"), c.get("ctx")),
      ),
    );

  return route;
};

export const createHttpServer = ({
  fileRouter,
  uploadStuff,
  config,
  createContext,
}: {
  fileRouter: UploadStuffRouter;
  uploadStuff: AnyUploadStuff;
  config: Partial<UploadStuffHTTPServerConfig>;
  createContext: (opts: { headers: Headers }) => Promise<ValidContextObject>;
}) => {
  const mergedConfig = { ...defaultConfig, ...config };

  const route = createRoutes({
    fileRouter,
    uploadStuff,
    createContext,
  });

  const app = new Hono().basePath(mergedConfig.basePath).route("/", route);

  return app;
};

export type UploadStuffHTTPServerType = ReturnType<typeof createRoutes>;
