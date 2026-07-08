/* oxlint-disable @typescript-eslint/no-explicit-any */
import type { UploadStuff } from "../upload-stuff";
import type {
  AnyBuiltUploaderTypes,
  AnyFileRoute,
  FieldsDeclaration,
  RouteConfig,
  UnsetMarker,
  UploadBuilder,
  ValidContextObject,
} from "@upload-stuff/core";

const internalCreateBuilder = <
  TContext extends ValidContextObject,
  TFieldsDeclaration extends FieldsDeclaration,
>(
  initDef: Partial<AnyFileRoute> = {},
): UploadBuilder<{
    _routeConfig: RouteConfig;
    _input: {
      in: UnsetMarker;
      out: UnsetMarker;
    };
    _fields: UnsetMarker;
    _fieldsDeclaration: TFieldsDeclaration;
    _middlewareData: UnsetMarker;
    _ctx: TContext;
    _completeFnData: UnsetMarker;
  }> => {
  const _def: AnyFileRoute = {
    $types: {} as AnyBuiltUploaderTypes,
    routeConfig: {} as RouteConfig,
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
    fields: () => ({}),
    onUploadComplete: () => ({}),

    ...initDef,
  };

  return {
    input(parser) {
      return internalCreateBuilder<TContext, TFieldsDeclaration>({
        ..._def,
        inputParser: parser,
      }) as UploadBuilder<any>;
    },

    middleware(fn) {
      return internalCreateBuilder<TContext, TFieldsDeclaration>({
        ..._def,
        middleware: fn,
      }) as UploadBuilder<any>;
    },

    fields(fn) {
      return internalCreateBuilder<TContext, TFieldsDeclaration>({
        ..._def,
        fields: fn,
      }) as UploadBuilder<any>;
    },

    onUploadComplete(fn) {
      return internalCreateBuilder<TContext, TFieldsDeclaration>({
        ..._def,
        onUploadComplete: fn,
      }) as UploadBuilder<any>;
    },

    // `build`'s public return type is conditional on the fields declaration (see
    // UploadBuilder) and is generic here, so it can't be reconstructed inline.
    // Return `any` from the impl — assignable to whichever branch the conditional
    // resolves to — without an outer cast that would strip contextual typing from
    // the chain-method parameters above.
    build: (): any => _def,
  };
};

/**
 * Create a route factory bound to an instance's fields and a request-context
 * type. Call the returned function with a {@link RouteConfig} to get a fluent
 * builder, then chain `.middleware`/`.input`/`.fields`/`.onUploadComplete` and
 * finish with `.build()`. Collect the built routes into a `fileRouter` map.
 *
 * @typeParam TUploadStuff - your `UploadStuff` instance type (`typeof uploadStuff`)
 * @typeParam TContext - the context produced by the handler's `createContext`
 * @example
 * const route = createUploadStuffRouter<typeof uploadStuff, Ctx>();
 * export const fileRouter = {
 *   avatar: route({ isPublic: true, files: ["image/*"] })
 *     .middleware(({ ctx }) => ({ userId: ctx.userId }))
 *     .onUploadComplete(({ files }) => ({ count: files.length }))
 *     .build(),
 * };
 */
export const createUploadStuffRouter =
  <
    TUploadStuff extends UploadStuff<any>,
    TContext extends ValidContextObject = Record<never, never>,
  >() =>
  (
    routeConfig: RouteConfig,
  ): UploadBuilder<{
      _routeConfig: RouteConfig;
      _input: {
        in: UnsetMarker;
        out: UnsetMarker;
      };
      _fields: UnsetMarker;
      _fieldsDeclaration: TUploadStuff["$types"]["fields"];
      _middlewareData: UnsetMarker;
      _ctx: TContext;
      _completeFnData: UnsetMarker;
    }> => {
    return internalCreateBuilder<
      TContext,
      TUploadStuff["$types"]["fields"]
    >({
      routeConfig,
    });
  };
