import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { Hono } from "hono";
import { z } from "zod";

import {
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

export interface UploadStuffHTTPServerConfig {
  basePath: string;
}

const defaultConfig: UploadStuffHTTPServerConfig = {
  basePath: "/api/upload-stuff",
};

const initUploadHandlerSchema = z.object({
  files: z.array(initUploadFileSchema),
  input: z.json(),
});

const completeUploadHandlerSchema = z.object({
  batchId: z.string(),
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
    .get("/:endpoint/route-config", async (c) => {
      const endpoint = getEndpoint(c);

      try {
        const config = routeHandler.getConfig({ endpoint });

        return c.json(config);
      } catch (error) {
        return handleError(c, error);
      }
    })
    .post(
      "/:endpoint/init-upload",
      zValidator("json", initUploadHandlerSchema),
      async (c) => {
        const endpoint = getEndpoint(c);
        const ctx = c.get("ctx");

        const data = c.req.valid("json");

        try {
          const result = await routeHandler.initUpload(endpoint, data, ctx);
          return c.json(result);
        } catch (error) {
          return handleError(c, error);
        }
      },
    )
    .post(
      "/:endpoint/complete-upload",
      zValidator("json", completeUploadHandlerSchema),
      async (c) => {
        const endpoint = getEndpoint(c);
        const ctx = c.get("ctx");

        const data = c.req.valid("json");

        try {
          const result = await routeHandler.completeUpload(endpoint, data, ctx);
          return c.json(result);
        } catch (error) {
          return handleError(c, error);
        }
      },
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
