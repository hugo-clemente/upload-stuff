import { describe, expectTypeOf, it } from "vite-plus/test";

import type {
  AnyFileRoute,
  FileRoute,
  UnsetMarker,
  UploadBuilder,
  inferRouteInput,
} from "./router-types";

describe("inferRouteInput", () => {
  it("resolves to any for AnyFileRoute (input is any)", () => {
    expectTypeOf<inferRouteInput<AnyFileRoute>>().toBeAny();
  });

  it("resolves to the declared input type when input is set", () => {
    type Route = FileRoute<
      {
        fileUsageContext: "avatar";
        input: { albumId: string };
        output: unknown;
        middlewareData: unknown;
        context: { userId?: string };
      },
      "avatar"
    >;
    expectTypeOf<inferRouteInput<Route>>().toEqualTypeOf<{ albumId: string }>();
  });
});

describe("UploadBuilder", () => {
  type Builder = UploadBuilder<
    {
      _routeConfig: unknown;
      _input: { in: UnsetMarker; out: UnsetMarker };
      _scope: UnsetMarker;
      _fields: UnsetMarker;
      _fieldsDeclaration: Record<string, never>;
      _middlewareData: { role: string };
      _ctx: { userId?: string };
      _completeFnData: UnsetMarker;
    },
    "avatar"
  >;

  it("types middlewareData from the middleware output", () => {
    type CompleteFn = Parameters<Builder["onUploadComplete"]>[0];
    type CompleteFnParams = Parameters<CompleteFn>[0];
    expectTypeOf<CompleteFnParams["middlewareData"]>().toEqualTypeOf<{ role: string }>();
  });

  it("exposes scope and fields, not the removed metadata", () => {
    expectTypeOf<Builder>().toHaveProperty("scope");
    expectTypeOf<Builder>().toHaveProperty("fields");
    expectTypeOf<Builder>().not.toHaveProperty("metadata");
  });

  it("scope resolver reads ctx only and returns a string or undefined", () => {
    type ScopeFn = Parameters<Builder["scope"]>[0];
    type ScopeParams = Parameters<ScopeFn>[0];
    expectTypeOf<ScopeParams>().toEqualTypeOf<{ ctx: { userId?: string } }>();
    expectTypeOf<ReturnType<ScopeFn>>().toEqualTypeOf<string | undefined | Promise<string | undefined>>();
  });
});
