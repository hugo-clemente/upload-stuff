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
  batchToken: string;
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
    fields: uploadStuff.__fields,
  });

  const getRoute = (endpoint: string) => {
    const route = fileRouter[endpoint];

    if (!route) {
      throw new UploadStuffError({
        code: "BAD_REQUEST",
        message: `Route ${endpoint} not found`,
      });
    }

    return route;
  };

  return {
    initUpload: async (endpoint, { files, input }, ctx) => {
      const route = getRoute(endpoint);

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

      const fieldValues = await route.fields({
        files,
        input: parsedInput,
        ctx,
        middlewareData,
      });

      const result = await core.initUpload({
        files,
        config: route.routeConfig,
        input: parsedInput as Json,
        fieldValues,
        middlewareData,
        endpoint,
      });

      return result;
    },

    completeUpload: async (endpoint, { batchToken }, ctx) => {
      const route = getRoute(endpoint);

      const { files, input, middlewareData, alreadyCompleted } = await core.completeUpload({
        batchToken,
        endpoint,
      });

      // Skip onUploadComplete when the batch was already finalised — it ran
      // once on the first completion and re-running duplicates side-effects.
      const serverData = alreadyCompleted
        ? undefined
        : await route.onUploadComplete({
            files,
            input,
            middlewareData,
          });

      return {
        files,
        serverData,
      };
    },

    getConfig: ({ endpoint }) => {
      return getRoute(endpoint).routeConfig;
    },
  };
};
