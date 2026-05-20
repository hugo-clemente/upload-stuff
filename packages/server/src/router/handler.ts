import { z } from "zod";

import type { AnyUploadStuff } from "../upload-stuff";
import { createCore } from "./core";
import {
  UploadStuffError,
  type CompleteUploadResult,
  type InitUploadFileData,
  type InitUploadResult,
  type Json,
  type RouteConfig,
  type UploadStuffRouter,
  type ValidContextObject,
} from "@upload-stuff/core";

export type InitUploadHandlerData = {
  files: InitUploadFileData[];
  input: Json;
};

export type CompleteUploadHandlerData = {
  batchId: string;
};

export type RouteHandlers = {
  initUpload: (
    endpoint: string,
    data: InitUploadHandlerData,
    ctx: ValidContextObject,
  ) => Promise<InitUploadResult>;

  completeUpload: (
    endpoint: string,
    data: CompleteUploadHandlerData,
    ctx: ValidContextObject,
  ) => Promise<CompleteUploadResult>;

  getConfig: (params: { endpoint: string }) => RouteConfig<string>;
};

export const fileRouteHandlers = ({
  fileRouter,
  uploadStuff,
}: {
  fileRouter: UploadStuffRouter;
  uploadStuff: AnyUploadStuff;
}): RouteHandlers => {
  const core = createCore({
    storageAdapter: uploadStuff.__storageAdapter,
    databaseAdapter: uploadStuff.__databaseAdapter,
    fileIdGenerator: uploadStuff.__fileIdGenerator,
    fileKeyGenerator: uploadStuff.__fileKeyGenerator,
    filePublicUrlGenerator: uploadStuff.__filePublicUrlGenerator,
  });

  return {
    initUpload: async (endpoint, { files, input }, ctx) => {
      const route = fileRouter[endpoint];

      if (!route) {
        throw new UploadStuffError({
          code: "BAD_REQUEST",
          message: `Route ${endpoint} not found`,
        });
      }

      const inputParsed = await route.inputParser["~standard"].validate(input);

      if (inputParsed.issues) {
        throw new UploadStuffError({
          code: "INPUT_VALIDATION_ERROR",
          message: `Input validation failed: ${z.prettifyError({
            issues: inputParsed.issues,
          })}`,
        });
      }

      const parsedInput = inputParsed.value;

      const middlewareData = await route.middleware({
        files,
        input: parsedInput,
        ctx,
      });

      const metadata = await route.metadata({
        files,
        input: parsedInput,
        ctx,
        middlewareData,
      });

      const result = await core.initUpload({
        files,
        config: route.routeConfig,
        input: parsedInput as Json,
        metadata,
        middlewareData,
        ctx,
        endpoint,
      });

      return result;
    },

    completeUpload: async (endpoint, { batchId }, ctx) => {
      const route = fileRouter[endpoint];

      if (!route) {
        throw new UploadStuffError({
          code: "BAD_REQUEST",
          message: `Route ${endpoint} not found`,
        });
      }

      const { files, input, middlewareData } = await core.completeUpload({
        batchId,
        ctx,
        endpoint,
      });

      const serverData = await route.onUploadComplete({
        files,
        ctx,
        input,
        middlewareData,
      });

      return {
        files,
        serverData,
      };
    },

    getConfig: ({ endpoint }) => {
      const route = fileRouter[endpoint];

      if (!route) {
        throw new UploadStuffError({
          code: "BAD_REQUEST",
          message: `Route ${endpoint} not found`,
        });
      }

      return route.routeConfig;
    },
  };
};
