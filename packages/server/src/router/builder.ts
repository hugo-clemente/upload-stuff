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
  TFileUsageContext extends string,
  TFieldsDeclaration extends FieldsDeclaration,
>(
  initDef: Partial<AnyFileRoute> = {},
): UploadBuilder<
  {
    _routeConfig: RouteConfig<TFileUsageContext>;
    _input: {
      in: UnsetMarker;
      out: UnsetMarker;
    };
    _fields: UnsetMarker;
    _fieldsDeclaration: TFieldsDeclaration;
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
    fields: () => ({}),
    onUploadComplete: () => ({}),

    ...initDef,
  };

  return {
    input(parser) {
      return internalCreateBuilder<TContext, TFileUsageContext, TFieldsDeclaration>({
        ..._def,
        inputParser: parser,
      }) as UploadBuilder<any, TFileUsageContext>;
    },

    middleware(fn) {
      return internalCreateBuilder<TContext, TFileUsageContext, TFieldsDeclaration>({
        ..._def,
        middleware: fn,
      }) as UploadBuilder<any, TFileUsageContext>;
    },

    fields(fn) {
      return internalCreateBuilder<TContext, TFileUsageContext, TFieldsDeclaration>({
        ..._def,
        fields: fn,
      }) as UploadBuilder<any, TFileUsageContext>;
    },

    onUploadComplete(fn) {
      return internalCreateBuilder<TContext, TFileUsageContext, TFieldsDeclaration>({
        ..._def,
        onUploadComplete: fn,
      }) as UploadBuilder<any, TFileUsageContext>;
    },

    // `build`'s public return type is conditional on the fields declaration (see
    // UploadBuilder) and is generic here, so it can't be reconstructed inline.
    // Return `any` from the impl — assignable to whichever branch the conditional
    // resolves to — without an outer cast that would strip contextual typing from
    // the chain-method parameters above.
    build: (): any => _def,
  };
};

export const createUploadStuffRouter =
  <TContext extends ValidContextObject, TUploadStuff extends UploadStuff<any, any>>() =>
  (
    routeConfig: RouteConfig<TUploadStuff["$types"]["fileUsageContext"]>,
  ): UploadBuilder<
    {
      _routeConfig: RouteConfig<TUploadStuff["$types"]["fileUsageContext"]>;
      _input: {
        in: UnsetMarker;
        out: UnsetMarker;
      };
      _fields: UnsetMarker;
      _fieldsDeclaration: TUploadStuff["$types"]["fields"];
      _middlewareData: UnsetMarker;
      _ctx: TContext;
      _completeFnData: UnsetMarker;
    },
    TUploadStuff["$types"]["fileUsageContext"]
  > => {
    return internalCreateBuilder<
      TContext,
      TUploadStuff["$types"]["fileUsageContext"],
      TUploadStuff["$types"]["fields"]
    >({
      routeConfig,
    });
  };
