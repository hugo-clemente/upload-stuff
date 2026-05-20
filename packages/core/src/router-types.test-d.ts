import { describe, expectTypeOf, it } from "vitest";

import type { AnyFileRoute, FileRoute, inferRouteInput } from "./router-types";

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
