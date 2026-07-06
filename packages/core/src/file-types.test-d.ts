import { describe, expectTypeOf, it } from "vite-plus/test";

import { customMime } from "./file-types";
import type { RouteConfig } from "./router-types";
import type { CustomMimeLiteral, FileTypeKey } from "./file-types";

describe("FileTypeKey", () => {
  it("accepts blob, known literals, wildcards, and customMime keys", () => {
    expectTypeOf<"image">().not.toExtend<FileTypeKey>();
    expectTypeOf<"pdf">().not.toExtend<FileTypeKey>();
    expectTypeOf<"blob">().toExtend<FileTypeKey>();
    expectTypeOf<"image/*">().toExtend<FileTypeKey>();
    expectTypeOf<"image/png">().toExtend<FileTypeKey>();
    expectTypeOf<"application/pdf">().toExtend<FileTypeKey>();
    expectTypeOf<"application/*">().toExtend<FileTypeKey>();
    expectTypeOf<CustomMimeLiteral>().toExtend<FileTypeKey>();
  });

  it("rejects typo literals unless they come from customMime", () => {
    expectTypeOf<"image/pgn">().not.toExtend<FileTypeKey>();
    const custom = customMime("application/vnd.acme.bundle+json");
    expectTypeOf(custom).toExtend<CustomMimeLiteral>();

    const ok = {
      isPublic: false,
      usageContext: "doc",
      files: { [custom]: {} },
    } satisfies RouteConfig<"doc">;
    expectTypeOf(ok).toMatchTypeOf<RouteConfig<"doc">>();

    // @ts-expect-error image/pgn is not a generated MIME literal.
    const bad = { isPublic: false, usageContext: "doc", files: { "image/pgn": {} } } satisfies RouteConfig<"doc">;
    void bad;

    // @ts-expect-error legacy `type` field was removed from RouteConfig
    const legacy = { isPublic: false, usageContext: "doc", files: { "blob": {} }, type: "blob" } satisfies RouteConfig<"doc">;
    void legacy;
  });
});
