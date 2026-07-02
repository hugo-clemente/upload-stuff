/* oxlint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useMemo, useRef, useState } from "react";

import useSWR from "swr";

import type {
  AnyFileRoute,
  CompleteUploadResult,
  EndpointArg,
  RouteConfig,
  UploadCallbacks,
  UploadStuffClient,
  UploadStuffRouter,
  inferRouteInput,
  inferRouteServerData,
} from "@upload-stuff/client";
import { getAcceptFromType, mergeHeaders, resolveEndpoint } from "@upload-stuff/client";

export type UseUploadStuffOptions<TRoute extends AnyFileRoute> = UploadCallbacks<TRoute> & {
  /**
   * Sent on init and complete requests. Merged under per-call
   * `startUpload(..., { headers })` — the per-call value wins.
   */
  headers?: HeadersInit;
};

export type StartUploadFnOptions = {
  signal?: AbortSignal;
  headers?: HeadersInit;
};

export type StartUploadFn<TRoute extends AnyFileRoute> =
  // Tuple-wrapped to opt out of TS's "conditional type over a bare `any`
  // check type resolves to the union of both branches" behavior. Without
  // it, `StartUploadFn<any>` (what `createUploadStuffReactHelpers<any>`
  // produces in tests) becomes a union of the two function signatures,
  // and calling it with just `files` fails to type-check because the
  // union's stricter (input-required) branch demands a second argument.
  [inferRouteInput<TRoute>] extends [undefined]
    ? (
        files: File[],
        input?: undefined,
        options?: StartUploadFnOptions,
      ) => Promise<CompleteUploadResult<inferRouteServerData<TRoute>>>
    : (
        files: File[],
        input: inferRouteInput<TRoute>,
        options?: StartUploadFnOptions,
      ) => Promise<CompleteUploadResult<inferRouteServerData<TRoute>>>;

export type UseUploadStuffReturn<TRoute extends AnyFileRoute> = {
  startUpload: StartUploadFn<TRoute>;
  /**
   * Is the hook ready to be used?
   */
  isLoading: boolean;
  /**
   * Are files currently being uploaded?
   */
  isUploading: boolean;
  routeConfig?: RouteConfig<TRoute["$types"]["fileUsageContext"]>;
  accept?: string;
};

export const createUploadStuffReactHelpers = <TFileRouter extends UploadStuffRouter>(
  client: UploadStuffClient<TFileRouter>,
) => {
  const useRouteConfig = <TEndpoint extends keyof TFileRouter>(endpoint: TEndpoint) =>
    useSWR(`upload-stuff/${endpoint as string}/route-config`, () =>
      client.fetchRouteConfig(endpoint),
    );

  const useUploadStuff = <
    TEndpoint extends keyof TFileRouter,
    TRoute extends TFileRouter[TEndpoint],
  >(
    endpoint: EndpointArg<TFileRouter, TEndpoint>,
    opts?: UseUploadStuffOptions<TRoute>,
  ): UseUploadStuffReturn<TRoute> => {
    const [isUploading, setIsUploading] = useState(false);
    // Synchronous double-submit guard: `isUploading` state lands on the next
    // render, so a second startUpload in the same tick would otherwise start
    // a second engine run.
    const isUploadingRef = useRef(false);

    const resolvedEndpoint = useMemo(
      () => resolveEndpoint<TFileRouter, TEndpoint>(endpoint),
      [endpoint],
    );

    const { data: routeConfig, isLoading } = useRouteConfig(resolvedEndpoint);

    const accept = useMemo(
      () => (routeConfig ? getAcceptFromType(routeConfig.type) : undefined),
      [routeConfig],
    );

    const startUpload = useCallback(
      (async (files: File[], input: any, runOpts?: StartUploadFnOptions) => {
        if (isUploadingRef.current) {
          throw new Error("An upload is already in progress");
        }
        isUploadingRef.current = true;
        setIsUploading(true);
        try {
          return await client.uploadFiles(resolvedEndpoint, files, {
            ...opts,
            input,
            // SWR's copy — may still be undefined, the engine then fetches it.
            routeConfig,
            signal: runOpts?.signal,
            headers: mergeHeaders(opts?.headers, runOpts?.headers),
          } as any);
        } finally {
          isUploadingRef.current = false;
          setIsUploading(false);
        }
      }) as StartUploadFn<TRoute>,
      [opts, routeConfig, resolvedEndpoint],
    );

    return {
      startUpload,
      isUploading,
      routeConfig,
      accept,
      isLoading,
    };
  };

  return {
    useRouteConfig,
    useUploadStuff,
  };
};
