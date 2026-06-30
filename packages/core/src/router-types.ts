/* oxlint-disable @typescript-eslint/no-explicit-any */
import type * as Standard from "@standard-schema/spec";

import type { AcceptedFileType, FileSize } from "./utils/helpers";
import type { Json } from "./utils/types";
import type { FieldsDeclaration, InferFieldValues } from "./types";
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

/**
 * The request context, fully defined by the consumer. The library no longer
 * requires any particular field.
 *
 * Constrained to `object` rather than `Record<string, unknown>` on purpose:
 * interfaces (e.g. `interface AppContext { userId: string }`) lack an implicit
 * index signature and so do NOT satisfy `Record<string, unknown>`, which would
 * make the "fully user-defined context" API reject the most common context
 * shape consumers pass to `createUploadStuffRouter` / `toNextJsHandler`.
 */
export type ValidContextObject = object;

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

type FieldsFn<
  TContext extends ValidContextObject,
  TInput extends Json | UnsetMarker,
  TMiddlewareData extends ValidMiddlewareObject | UnsetMarker,
  TFields extends FieldsDeclaration,
> = (params: {
  files: InitUploadFileData[];
  input: TInput;
  middlewareData: TMiddlewareData;
  ctx: TContext;
}) => InferFieldValues<TFields> | Promise<InferFieldValues<TFields>>;

type UploadCompleteFn<
  _TContext extends ValidContextObject,
  TInput extends Json | UnsetMarker,
  TMiddlewareData extends ValidMiddlewareObject | UnsetMarker,
  TOutput extends Json | void,
> = (params: {
  files: UploadedFileData[];
  input: TInput;
  middlewareData: TMiddlewareData;
}) => TOutput | Promise<TOutput>;

export type AnyBuiltUploaderTypes = {
  fileUsageContext: string;
  input: any;
  output: any;
  middlewareData: any;
  context: any;
};

export type FileRoute<TTypes extends AnyBuiltUploaderTypes, TFileUsageContext extends string> = {
  $types: TTypes;
  routeConfig: RouteConfig<TFileUsageContext>;
  inputParser: Standard.StandardSchemaV1;
  middleware: MiddlewareFn<any, any, ValidMiddlewareObject>;
  fields: FieldsFn<any, any, any, any>;
  onUploadComplete: UploadCompleteFn<any, any, any, any>;
};

export type AnyFileRoute = FileRoute<AnyBuiltUploaderTypes, any>;

/** Keys of a fields declaration whose attributes mark them `required: true`. */
type RequiredFieldKeys<TFieldsDeclaration> = keyof {
  [K in keyof TFieldsDeclaration as TFieldsDeclaration[K] extends { required: true }
    ? K
    : never]: true;
};

/** Whether a fields declaration has at least one `required: true` field. */
type HasRequiredField<TFieldsDeclaration> = [RequiredFieldKeys<TFieldsDeclaration>] extends [never]
  ? false
  : true;

type BuiltFileRoute<TParams extends AnyParams, TFileUsageContext extends string> = FileRoute<
  {
    fileUsageContext: TFileUsageContext;
    input: TParams["_input"]["in"];
    output: TParams["_completeFnData"];
    middlewareData: TParams["_middlewareData"];
    context: TParams["_ctx"];
  },
  TFileUsageContext
>;

type AnyParams = {
  _routeConfig: any;
  _input: {
    in: any;
    out: any;
  };
  _fields: any;
  _fieldsDeclaration: any;
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
      _fields: TParams["_fields"];
      _fieldsDeclaration: TParams["_fieldsDeclaration"];
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
      _fields: TParams["_fields"];
      _fieldsDeclaration: TParams["_fieldsDeclaration"];
      _middlewareData: TOut;
      _ctx: TParams["_ctx"];
      _completeFnData: TParams["_completeFnData"];
    },
    TFileUsageContext
  >;

  fields: (
    fn: TParams["_fields"] extends UnsetMarker
      ? FieldsFn<
          TParams["_ctx"],
          TParams["_input"]["out"],
          TParams["_middlewareData"],
          TParams["_fieldsDeclaration"]
        >
      : ErrorMessage<"fields has already been set">,
  ) => UploadBuilder<
    {
      _routeConfig: TParams["_routeConfig"];
      _input: TParams["_input"];
      _fields: InferFieldValues<TParams["_fieldsDeclaration"]>;
      _fieldsDeclaration: TParams["_fieldsDeclaration"];
      _middlewareData: TParams["_middlewareData"];
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
      _fields: TParams["_fields"];
      _fieldsDeclaration: TParams["_fieldsDeclaration"];
      _ctx: TParams["_ctx"];
      _middlewareData: TParams["_middlewareData"];
      _completeFnData: TOut;
    },
    TFileUsageContext
  >;

  /**
   * Finalise the route. When the instance's fields declaration contains a
   * `required: true` field but `.fields()` was never called, this resolves to an
   * error message instead of a `FileRoute` — persisting `{}` for a required
   * column would otherwise only fail later at insert time (NOT NULL violation).
   */
  build: () => HasRequiredField<TParams["_fieldsDeclaration"]> extends true
    ? TParams["_fields"] extends UnsetMarker
      ? ErrorMessage<"`.fields()` is required: this instance declares a required custom field">
      : BuiltFileRoute<TParams, TFileUsageContext>
    : BuiltFileRoute<TParams, TFileUsageContext>;
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
      middlewareData: any;
      context: TContext;
    },
    TFileUsageContext
  >
>;

export type InitUploadResult = {
  batchToken: string;
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
