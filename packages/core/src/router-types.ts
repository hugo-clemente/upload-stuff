/* oxlint-disable @typescript-eslint/no-explicit-any */
import type * as Standard from "@standard-schema/spec";

import type { AcceptedFileType, FileSize } from "./utils/helpers";
import type { Json } from "./utils/types";
import type { InitUploadFileData, ToUploadFileData, UploadedFileData } from "./schemas";

export type UnsetMarker = "unsetMarker" & { __brand: "unsetMarker" };
export type ErrorMessage<TError extends string> = TError;

export type RouteConfig<TFileUsageContext extends string> = {
  isPublic: boolean;
  type: AcceptedFileType | AcceptedFileType[];
  usageContext: TFileUsageContext;
  maxFileSize: FileSize;
  maxFileCount?: number;
};
export type AnyRouteConfig = RouteConfig<string>;

export type ValidContextObject = {
  userId?: string;
};

export type ValidMiddlewareObject = {
  [key: string]: unknown;
};

type MiddlewareFn<
  TContext extends ValidContextObject,
  TInput extends Json | UnsetMarker,
  TOutput extends ValidMiddlewareObject,
> = (params: {
  files: InitUploadFileData[];
  input: TInput;
  ctx: TContext;
}) => TOutput | Promise<TOutput>;

export type MetadataObject = {
  entityId?: string;
};

type MetadataFn<
  TContext extends ValidContextObject,
  TInput extends Json | UnsetMarker,
  TMiddlewareData extends ValidMiddlewareObject | UnsetMarker,
> = (params: {
  files: InitUploadFileData[];
  input: TInput;
  middlewareData: TMiddlewareData;
  ctx: TContext;
}) => MetadataObject | Promise<MetadataObject>;

type UploadCompleteFn<
  TContext extends ValidContextObject,
  TInput extends Json | UnsetMarker,
  TMiddlewareData extends ValidMiddlewareObject | UnsetMarker,
  TOutput extends Json | void,
> = (params: {
  files: UploadedFileData[];
  input: TInput;
  ctx: TContext;
  middlewareData: TMiddlewareData;
}) => TOutput | Promise<TOutput>;

export type AnyBuiltUploaderTypes = {
  fileUsageContext: string;
  input: any;
  output: any;
  metadata: any;
  middlewareData: any;
  context: any;
};

export type FileRoute<TTypes extends AnyBuiltUploaderTypes, TFileUsageContext extends string> = {
  $types: TTypes;
  routeConfig: RouteConfig<TFileUsageContext>;
  inputParser: Standard.StandardSchemaV1;
  middleware: MiddlewareFn<any, any, ValidMiddlewareObject>;
  metadata: MetadataFn<any, any, any>;
  onUploadComplete: UploadCompleteFn<any, any, any, any>;
};

export type AnyFileRoute = FileRoute<AnyBuiltUploaderTypes, any>;

type AnyParams = {
  _routeConfig: any;
  _input: {
    in: any;
    out: any;
  };
  _metadata: any;
  _middlewareData: any;
  _ctx: any;
  _completeFnData: any;
};

export interface UploadBuilder<TParams extends AnyParams, TFileUsageContext extends string> {
  input: <TIn extends Json, TOut>(
    parser: TParams["_input"]["in"] extends UnsetMarker
      ? Standard.StandardSchemaV1<TIn, TOut>
      : ErrorMessage<"input has already been set">,
  ) => UploadBuilder<
    {
      _routeConfig: TParams["_routeConfig"];
      _input: {
        in: TIn;
        out: TOut;
      };
      _metadata: TParams["_metadata"];
      _middlewareData: TParams["_middlewareData"];
      _ctx: TParams["_ctx"];
      _completeFnData: TParams["_completeFnData"];
    },
    TFileUsageContext
  >;

  metadata: (
    fn: TParams["_metadata"] extends UnsetMarker
      ? MetadataFn<TParams["_ctx"], TParams["_input"]["out"], TParams["_middlewareData"]>
      : ErrorMessage<"metadata has already been set">,
  ) => UploadBuilder<
    {
      _routeConfig: TParams["_routeConfig"];
      _input: TParams["_input"];
      _metadata: MetadataObject;
      _middlewareData: TParams["_middlewareData"];
      _ctx: TParams["_ctx"];
      _completeFnData: TParams["_completeFnData"];
    },
    TFileUsageContext
  >;

  middleware: <TOut extends ValidMiddlewareObject>(
    fn: TParams["_middlewareData"] extends UnsetMarker
      ? MiddlewareFn<TParams["_ctx"], TParams["_input"]["out"], TOut>
      : ErrorMessage<"middleware has already been set">,
  ) => UploadBuilder<
    {
      _routeConfig: TParams["_routeConfig"];
      _input: TParams["_input"];
      _metadata: TParams["_metadata"];
      _middlewareData: TOut;
      _ctx: TParams["_ctx"];
      _completeFnData: TParams["_completeFnData"];
    },
    TFileUsageContext
  >;

  onUploadComplete: <TOut extends Json | void>(
    fn: TParams["_completeFnData"] extends UnsetMarker
      ? UploadCompleteFn<TParams["_ctx"], TParams["_input"]["out"], TParams["_middlewareData"], TOut>
      : ErrorMessage<"onUploadComplete has already been set">,
  ) => UploadBuilder<
    {
      _routeConfig: TParams["_routeConfig"];
      _input: TParams["_input"];
      _metadata: TParams["_metadata"];
      _ctx: TParams["_ctx"];
      _middlewareData: TParams["_middlewareData"];
      _completeFnData: TOut;
    },
    TFileUsageContext
  >;

  build: () => FileRoute<
    {
      fileUsageContext: TFileUsageContext;
      input: TParams["_input"]["in"];
      output: TParams["_completeFnData"];
      metadata: TParams["_metadata"];
      middlewareData: TParams["_middlewareData"];
      context: TParams["_ctx"];
    },
    TFileUsageContext
  >;
}

export type UploadStuffRouter = Record<string, AnyFileRoute>;

export type UploadStuffRouterWithContext<
  TContext extends ValidContextObject,
  TFileUsageContext extends string,
> = Record<
  string,
  FileRoute<
    {
      fileUsageContext: TFileUsageContext;
      input: any;
      output: any;
      metadata: any;
      middlewareData: any;
      context: TContext;
    },
    TFileUsageContext
  >
>;

export type InitUploadResult = {
  batchId: string;
  files: Array<ToUploadFileData>;
};

export type CompleteUploadResult<TServerData extends Json = Json> = {
  files: Array<UploadedFileData>;
  serverData: TServerData;
};

export type inferRouteInput<TRoute extends AnyFileRoute> =
  TRoute["$types"]["input"] extends UnsetMarker ? undefined : TRoute["$types"]["input"];
export type inferRouteServerData<TRoute extends AnyFileRoute> = Awaited<
  TRoute["$types"]["output"] extends UnsetMarker ? null : TRoute["$types"]["output"]
>;
