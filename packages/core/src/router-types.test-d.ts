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
        metadata: unknown;
        middlewareData: unknown;
        context: { userId?: string };
      },
      "avatar"
    >;
    expectTypeOf<inferRouteInput<Route>>().toEqualTypeOf<{ albumId: string }>();
  });
});

describe("UploadBuilder.onUploadComplete", () => {
  it("types middlewareData from the middleware output, not the metadata", () => {
    type Builder = UploadBuilder<
      {
        _routeConfig: unknown;
        _input: { in: UnsetMarker; out: UnsetMarker };
        _metadata: { entityId?: string };
        _middlewareData: { role: string };
        _ctx: { userId?: string };
        _completeFnData: UnsetMarker;
      },
      "avatar"
    >;
    type CompleteFn = Parameters<Builder["onUploadComplete"]>[0];
    type CompleteFnParams = Parameters<CompleteFn>[0];
    expectTypeOf<CompleteFnParams["middlewareData"]>().toEqualTypeOf<{ role: string }>();
  });
});
