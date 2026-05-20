import { describe, expectTypeOf, it } from "vitest";

import type { AnyFileRoute, FileRoute, inferRouteInput } from "./router-types";

describe("inferRouteInput", () => {
  it("resolves to undefined when input is the UnsetMarker", () => {
    type Route = AnyFileRoute;
    expectTypeOf<inferRouteInput<Route>>().toEqualTypeOf<undefined>();
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
