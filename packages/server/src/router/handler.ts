import { z } from "zod";

import type { AnyUploadStuff } from "../upload-stuff";
import { createCore } from "./core";
import {
  UploadStuffError,
  normalizeRouteConfig,
  validateFiles,
  type CompleteUploadResult,
  type InitUploadFileData,
  type InitUploadResult,
  type Json,
  type NormalizedRouteConfig,
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

  getConfig: (params: { endpoint: string }) => NormalizedRouteConfig;
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
    uploadWindowSeconds: uploadStuff.__uploadWindowSeconds,
    defaultMaxFileCount: uploadStuff.__defaultMaxFileCount,
    defaultMaxFileSize: uploadStuff.__defaultMaxFileSize,
  });

  const normalizedConfigs = new Map<string, NormalizedRouteConfig>();
  for (const [endpoint, route] of Object.entries(fileRouter)) {
    normalizedConfigs.set(
      endpoint,
      normalizeRouteConfig(route.routeConfig, {
        defaultMaxFileCount: uploadStuff.__defaultMaxFileCount,
        defaultMaxFileSize: uploadStuff.__defaultMaxFileSize,
      }),
    );
  }

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

  const getNormalizedConfig = (endpoint: string) => {
    const config = normalizedConfigs.get(endpoint);
    if (!config) {
      throw new UploadStuffError({
        code: "BAD_REQUEST",
        message: `Route ${endpoint} not found`,
      });
    }
    return config;
  };

  return {
    initUpload: async (endpoint, { files, input }, ctx) => {
      const route = getRoute(endpoint);
      const normalizedConfig = getNormalizedConfig(endpoint);

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

      // Validate (and hand middleware/fields) the raw client content types so matching stays
      // honest - malformed/untyped values match `blob` only. Core folds to a storage-safe
      // value at the persistence/signing boundary.
      validateFiles(files, normalizedConfig);

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
        config: normalizedConfig,
        input: parsedInput as Json,
        fieldValues,
        middlewareData,
        endpoint,
      });

      return result;
    },

    completeUpload: async (endpoint, { batchToken }, _ctx) => {
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
      return getNormalizedConfig(endpoint);
    },
  };
};
