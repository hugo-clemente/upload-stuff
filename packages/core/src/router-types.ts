/* oxlint-disable @typescript-eslint/no-explicit-any */
import type * as Standard from "@standard-schema/spec";

import type { FilesConfig } from "./file-types";
import type { FileSize } from "./utils/helpers";
import type { Json } from "./utils/types";
import type { FieldsDeclaration, InferFieldValues } from "./types";
import type { InitUploadFileData, ToUploadFileData, UploadedFileData } from "./schemas";

export type UnsetMarker = "unsetMarker" & { __brand: "unsetMarker" };
export type ErrorMessage<TError extends string> = TError;

/**
 * Per-route upload rules, passed to `createUploadStuffRouter()(config)`.
 *
 * @example
 * createUploadStuffRouter()({
 *   isPublic: true,
 *   files: { "image/*": { maxFileSize: "8MB", maxFileCount: 4 } },
 * })
 */
export type RouteConfig = {
  /** Whether stored objects are world-readable (`public-read`) vs private. */
  isPublic: boolean;
  /** Accepted file types, either a list of keys or per-type constraints. */
  files: FilesConfig;
  /** Fallback size cap for types that don't set their own. @default "4MB" */
  maxFileSize?: FileSize;
  /** Cap on total files per upload. @default 20 (instance `defaultMaxFileCount`) */
  maxFileCount?: number;
};
export type AnyRouteConfig = RouteConfig;

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
  input: any;
  output: any;
  middlewareData: any;
  context: any;
};

export type FileRoute<TTypes extends AnyBuiltUploaderTypes> = {
  $types: TTypes;
  routeConfig: RouteConfig;
  inputParser: Standard.StandardSchemaV1;
  middleware: MiddlewareFn<any, any, ValidMiddlewareObject>;
  fields: FieldsFn<any, any, any, any>;
  onUploadComplete: UploadCompleteFn<any, any, any, any>;
};

export type AnyFileRoute = FileRoute<AnyBuiltUploaderTypes>;

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

type BuiltFileRoute<TParams extends AnyParams> = FileRoute<{
  input: TParams["_input"]["in"];
  output: TParams["_completeFnData"];
  middlewareData: TParams["_middlewareData"];
  context: TParams["_ctx"];
}>;

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

/**
 * Fluent route builder returned by `createUploadStuffRouter()(config)`. Each
 * method returns a new builder; call `.build()` last. All methods are optional
 * except `.build()` — and `.fields()`, which is required when the instance
 * declares a `required` custom field.
 */
export interface UploadBuilder<TParams extends AnyParams> {
  /**
   * Attach a Standard Schema parser for the per-upload `input`. The parsed
   * value is passed to `middleware`/`fields`/`onUploadComplete` and required at
   * the call site. Can be set once.
   */
  input: <TIn extends Json, TOut>(
    parser: TParams["_input"]["in"] extends UnsetMarker
      ? Standard.StandardSchemaV1<TIn, TOut>
      : ErrorMessage<"input has already been set">,
  ) => UploadBuilder<{
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
  }>;

  /**
   * Run auth/validation before the upload is authorized. Receives the request
   * `ctx`, `input`, and file metadata; throw (e.g. `UploadStuffError`) to reject.
   * Its return value flows to `fields`/`onUploadComplete` as `middlewareData`.
   * Can be set once.
   */
  middleware: <TOut extends ValidMiddlewareObject>(
    fn: TParams["_middlewareData"] extends UnsetMarker
      ? MiddlewareFn<TParams["_ctx"], TParams["_input"]["out"], TOut>
      : ErrorMessage<"middleware has already been set">,
  ) => UploadBuilder<{
    _routeConfig: TParams["_routeConfig"];
    _input: TParams["_input"];
    _fields: TParams["_fields"];
    _fieldsDeclaration: TParams["_fieldsDeclaration"];
    _middlewareData: TOut;
    _ctx: TParams["_ctx"];
    _completeFnData: TParams["_completeFnData"];
  }>;

  /**
   * Resolve values for the instance's declared custom `fields`, persisted on
   * each file row. Required when the instance declares a `required` field.
   * Can be set once.
   */
  fields: (
    fn: TParams["_fields"] extends UnsetMarker
      ? FieldsFn<
          TParams["_ctx"],
          TParams["_input"]["out"],
          TParams["_middlewareData"],
          TParams["_fieldsDeclaration"]
        >
      : ErrorMessage<"fields has already been set">,
  ) => UploadBuilder<{
    _routeConfig: TParams["_routeConfig"];
    _input: TParams["_input"];
    _fields: InferFieldValues<TParams["_fieldsDeclaration"]>;
    _fieldsDeclaration: TParams["_fieldsDeclaration"];
    _middlewareData: TParams["_middlewareData"];
    _ctx: TParams["_ctx"];
    _completeFnData: TParams["_completeFnData"];
  }>;

  /**
   * Run server-side after every file is stored and verified. Its return value
   * becomes the client's `serverData`. Runs exactly once per batch (skipped on
   * idempotent re-completion). Can be set once.
   */
  onUploadComplete: <TOut extends Json | void>(
    fn: TParams["_completeFnData"] extends UnsetMarker
      ? UploadCompleteFn<TParams["_ctx"], TParams["_input"]["out"], TParams["_middlewareData"], TOut>
      : ErrorMessage<"onUploadComplete has already been set">,
  ) => UploadBuilder<{
    _routeConfig: TParams["_routeConfig"];
    _input: TParams["_input"];
    _fields: TParams["_fields"];
    _fieldsDeclaration: TParams["_fieldsDeclaration"];
    _ctx: TParams["_ctx"];
    _middlewareData: TParams["_middlewareData"];
    _completeFnData: TOut;
  }>;

  /**
   * Finalise the route. When the instance's fields declaration contains a
   * `required: true` field but `.fields()` was never called, this resolves to an
   * error message instead of a `FileRoute` — persisting `{}` for a required
   * column would otherwise only fail later at insert time (NOT NULL violation).
   */
  build: () => HasRequiredField<TParams["_fieldsDeclaration"]> extends true
    ? TParams["_fields"] extends UnsetMarker
      ? ErrorMessage<"`.fields()` is required: this instance declares a required custom field">
      : BuiltFileRoute<TParams>
    : BuiltFileRoute<TParams>;
}

/** A map of endpoint name to built {@link FileRoute} — the shape you pass as `fileRouter`. */
export type UploadStuffRouter = Record<string, AnyFileRoute>;

export type UploadStuffRouterWithContext<TContext extends ValidContextObject> = Record<
  string,
  FileRoute<{
    input: any;
    output: any;
    middlewareData: any;
    context: TContext;
  }>
>;

/** Response of `init-upload`: presigned targets plus the batch token used to complete. */
export type InitUploadResult = {
  batchToken: string;
  files: Array<ToUploadFileData>;
};

/** Response of `complete-upload`: the stored files and the route's `onUploadComplete` return value. */
export type CompleteUploadResult<TServerData extends Json = Json> = {
  files: Array<UploadedFileData>;
  serverData: TServerData;
};

/** The route's `input` type, or `undefined` when it declares no `.input()`. */
export type inferRouteInput<TRoute extends AnyFileRoute> =
  TRoute["$types"]["input"] extends UnsetMarker ? undefined : TRoute["$types"]["input"];
/** Static type of the client's `serverData`: the `Awaited` return of the route's `onUploadComplete`, or `null` when it declares none. */
export type inferRouteServerData<TRoute extends AnyFileRoute> = Awaited<
  TRoute["$types"]["output"] extends UnsetMarker ? null : TRoute["$types"]["output"]
>;
