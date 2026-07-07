import { describe, expectTypeOf, it } from "vite-plus/test";

import type {
  AnyFileRoute,
  FileRoute,
  UnsetMarker,
  UploadBuilder,
  ValidContextObject,
  inferRouteInput,
} from "./router-types";

describe("ValidContextObject", () => {
  it("accepts interface-shaped contexts (no implicit index signature)", () => {
    interface AppContext {
      userId: string;
    }
    // Interfaces lack an implicit index signature, so they would fail a
    // `Record<string, unknown>` constraint. The "fully user-defined context"
    // API must still accept them.
    expectTypeOf<AppContext>().toMatchTypeOf<ValidContextObject>();
    expectTypeOf<{ userId: string }>().toMatchTypeOf<ValidContextObject>();
  });
});

describe("inferRouteInput", () => {
  it("resolves to any for AnyFileRoute (input is any)", () => {
    expectTypeOf<inferRouteInput<AnyFileRoute>>().toBeAny();
  });

  it("resolves to the declared input type when input is set", () => {
    type Route = FileRoute<{
      input: { albumId: string };
      output: unknown;
      middlewareData: unknown;
      context: { userId?: string };
    }>;
    expectTypeOf<inferRouteInput<Route>>().toEqualTypeOf<{ albumId: string }>();
  });
});

describe("UploadBuilder", () => {
  type Builder = UploadBuilder<{
    _routeConfig: unknown;
    _input: { in: UnsetMarker; out: UnsetMarker };
    _fields: UnsetMarker;
    _fieldsDeclaration: Record<never, never>;
    _middlewareData: { role: string };
    _ctx: { userId?: string };
    _completeFnData: UnsetMarker;
  }>;

  it("types middlewareData from the middleware output", () => {
    type CompleteFn = Parameters<Builder["onUploadComplete"]>[0];
    type CompleteFnParams = Parameters<CompleteFn>[0];
    expectTypeOf<CompleteFnParams["middlewareData"]>().toEqualTypeOf<{ role: string }>();
  });

  it("exposes fields but not scope or metadata", () => {
    expectTypeOf<Builder>().toHaveProperty("fields");
    expectTypeOf<Builder>().not.toHaveProperty("scope");
    expectTypeOf<Builder>().not.toHaveProperty("metadata");
  });
});

describe("build requires .fields() when a required field is declared (#3)", () => {
  type RequiredFieldsDeclaration = { count: { type: "number"; required: true } };

  type ParamsWith<TFields, TFieldsDeclaration> = {
    _routeConfig: unknown;
    _input: { in: UnsetMarker; out: UnsetMarker };
    _fields: TFields;
    _fieldsDeclaration: TFieldsDeclaration;
    _middlewareData: UnsetMarker;
    _ctx: { userId?: string };
    _completeFnData: UnsetMarker;
  };

  it("build() resolves to an error string when a required field is declared but .fields() is unset", () => {
    type Built = ReturnType<UploadBuilder<ParamsWith<UnsetMarker, RequiredFieldsDeclaration>>["build"]>;
    expectTypeOf<Built>().toEqualTypeOf<"`.fields()` is required: this instance declares a required custom field">();
  });

  it("build() resolves to a FileRoute once .fields() has been set", () => {
    type Built = ReturnType<UploadBuilder<ParamsWith<{ count: number }, RequiredFieldsDeclaration>>["build"]>;
    expectTypeOf<Built>().toMatchTypeOf<AnyFileRoute>();
  });

  it("build() resolves to a FileRoute when no required field is declared, even without .fields()", () => {
    type Built = ReturnType<UploadBuilder<ParamsWith<UnsetMarker, Record<never, never>>>["build"]>;
    expectTypeOf<Built>().toMatchTypeOf<AnyFileRoute>();
  });
});
