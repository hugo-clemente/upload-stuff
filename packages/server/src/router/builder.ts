/* oxlint-disable @typescript-eslint/no-explicit-any */
import type { UploadStuff } from "../upload-stuff";
import type {
  AnyBuiltUploaderTypes,
  AnyFileRoute,
  FileRoute,
  RouteConfig,
  UnsetMarker,
  UploadBuilder,
  ValidContextObject,
} from "@upload-stuff/core";

const internalCreateBuilder = <
  TContext extends ValidContextObject,
  TFileUsageContext extends string,
>(
  initDef: Partial<AnyFileRoute> = {},
): UploadBuilder<
  {
    _routeConfig: RouteConfig<TFileUsageContext>;
    _input: {
      in: UnsetMarker;
      out: UnsetMarker;
    };
    _metadata: UnsetMarker;
    _middlewareData: UnsetMarker;
    _ctx: TContext;
    _completeFnData: UnsetMarker;
  },
  TFileUsageContext
> => {
  const _def: AnyFileRoute = {
    $types: {} as AnyBuiltUploaderTypes,
    routeConfig: {} as RouteConfig<TFileUsageContext>,
    inputParser: {
      "~standard": {
        validate: () =>
          Promise.resolve({
            success: true,
            value: {},
          }),
        version: 1,
        vendor: "uploadstuff default parser",
      },
    },
    middleware: () => ({}),
    metadata: () => ({}),
    onUploadComplete: () => ({}),

    ...initDef,
  };

  return {
    input(parser) {
      return internalCreateBuilder<TContext, TFileUsageContext>({
        ..._def,
        inputParser: parser,
      }) as UploadBuilder<any, TFileUsageContext>;
    },

    metadata(fn) {
      return internalCreateBuilder<TContext, TFileUsageContext>({
        ..._def,
        metadata: fn,
      }) as UploadBuilder<any, TFileUsageContext>;
    },

    middleware(fn) {
      return internalCreateBuilder<TContext, TFileUsageContext>({
        ..._def,
        middleware: fn,
      }) as UploadBuilder<any, TFileUsageContext>;
    },

    onUploadComplete(fn) {
      return internalCreateBuilder<TContext, TFileUsageContext>({
        ..._def,
        onUploadComplete: fn,
      }) as UploadBuilder<any, TFileUsageContext>;
    },

    build: () => _def as FileRoute<any, TFileUsageContext>,
  };
};

export const createUploadStuffRouter =
  <TContext extends ValidContextObject, TUploadStuff extends UploadStuff<any>>() =>
  (
    routeConfig: RouteConfig<TUploadStuff["$types"]["fileUsageContext"]>,
  ): UploadBuilder<
    {
      _routeConfig: RouteConfig<TUploadStuff["$types"]["fileUsageContext"]>;
      _input: {
        in: UnsetMarker;
        out: UnsetMarker;
      };
      _metadata: UnsetMarker;
      _middlewareData: UnsetMarker;
      _ctx: TContext;
      _completeFnData: UnsetMarker;
    },
    TUploadStuff["$types"]["fileUsageContext"]
  > => {
    return internalCreateBuilder<TContext, TUploadStuff["$types"]["fileUsageContext"]>({
      routeConfig,
    });
  };
