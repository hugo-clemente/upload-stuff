/* oxlint-disable @typescript-eslint/no-explicit-any */
import { hc, parseResponse } from "hono/client";

import type { UploadStuffHTTPServerType } from "@upload-stuff/server/next";
import type {
  AnyRouteConfig,
  CompleteUploadResult,
  InitUploadResult,
  UploadStuffRouter,
  inferRouteServerData,
} from "@upload-stuff/core";
import { DEFAULT_BASE_PATH, getValidMimeTypes } from "@upload-stuff/core";

import { type EndpointArg, resolveEndpoint } from "./endpoint";
import { type RouteConfigHandle, createRouteConfigCache } from "./route-config";
import type { CreateUploadStuffClientOptions, UploadFilesArgs } from "./types";
import {
  type UploadController,
  type UploadRunDeps,
  createUploadController,
} from "./upload-controller";

/**
 * Derive an `<input accept>` string from a route's accepted file type(s).
 */
export const getAcceptFromType = (type: AnyRouteConfig["type"]) =>
  getValidMimeTypes(type).join(",");

export const createUploadStuffClient = <TFileRouter extends UploadStuffRouter>(
  options: CreateUploadStuffClientOptions,
) => {
  const basePath = options.basePath ?? DEFAULT_BASE_PATH;
  const honoClient = hc<UploadStuffHTTPServerType>(
    new URL(basePath, options.baseURL).toString(),
  );

  const fetchRouteConfig = async <TEndpoint extends keyof TFileRouter>(
    endpoint: EndpointArg<TFileRouter, TEndpoint>,
  ): Promise<TFileRouter[TEndpoint]["routeConfig"]> => {
    const resolved = resolveEndpoint<TFileRouter, TEndpoint>(endpoint);
    return (await parseResponse(
      honoClient[":endpoint"]["route-config"].$get({ param: { endpoint: resolved as string } }),
    )) as TFileRouter[TEndpoint]["routeConfig"];
  };

  // Single config data path: subscribers and upload runs share this cache,
  // keyed by resolved endpoint string (selector identity never matters).
  const configCache = createRouteConfigCache((endpoint) => fetchRouteConfig(endpoint as any));

  const routeConfig = <TEndpoint extends keyof TFileRouter>(
    endpoint: EndpointArg<TFileRouter, TEndpoint>,
  ) =>
    configCache(resolveEndpoint<TFileRouter, TEndpoint>(endpoint) as string) as RouteConfigHandle<
      TFileRouter[TEndpoint]["routeConfig"]
    >;

  const makeDeps = (resolved: string): UploadRunDeps => ({
    loadRouteConfig: () => configCache(resolved).load(),
    initUpload: (json, headers) =>
      parseResponse(
        honoClient[":endpoint"]["init-upload"].$post(
          { param: { endpoint: resolved }, json: json as any },
          { headers },
        ),
      ) as unknown as Promise<InitUploadResult>,
    completeUpload: (json, headers) =>
      parseResponse(
        honoClient[":endpoint"]["complete-upload"].$post(
          { param: { endpoint: resolved }, json },
          { headers },
        ),
      ) as unknown as Promise<CompleteUploadResult<any>>,
  });

  const createUpload = <TEndpoint extends keyof TFileRouter>(
    endpoint: EndpointArg<TFileRouter, TEndpoint>,
  ): UploadController<TFileRouter[TEndpoint]> =>
    createUploadController<TFileRouter[TEndpoint]>(
      makeDeps(resolveEndpoint<TFileRouter, TEndpoint>(endpoint) as string),
    );

  // One-shot sugar over an ephemeral controller — one orchestration
  // implementation; the pre-existing engine suite pins its behavior.
  const uploadFiles = <TEndpoint extends keyof TFileRouter>(
    endpoint: EndpointArg<TFileRouter, TEndpoint>,
    files: File[],
    ...args: UploadFilesArgs<TFileRouter[TEndpoint]>
  ): Promise<CompleteUploadResult<inferRouteServerData<TFileRouter[TEndpoint]>>> =>
    createUpload<TEndpoint>(endpoint).start(files, ...args);

  const client = { fetchRouteConfig, routeConfig, createUpload, uploadFiles };
  // Phantom marker (never set at runtime): carries TFileRouter in a directly
  // inferable position so framework bindings can infer the router from the
  // instance — inference cannot see type parameters that only appear inside
  // generic method signatures.
  return client as typeof client & { "~router"?: TFileRouter };
};

export type UploadStuffClient<TFileRouter extends UploadStuffRouter> = ReturnType<
  typeof createUploadStuffClient<TFileRouter>
>;
