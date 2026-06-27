import { describe, expect, it } from "vite-plus/test";

import { mergeHeaders } from "./headers";

describe("mergeHeaders", () => {
  it("merges multiple sources into a plain object", () => {
    expect(mergeHeaders({ a: "1" }, { b: "2" })).toEqual({ a: "1", b: "2" });
  });

  it("lets later sources override earlier ones (runOpts wins over opts)", () => {
    // header names normalize to lower-case via Headers
    expect(mergeHeaders({ "x-user": "opts" }, { "X-User": "runOpts" })).toEqual({
      "x-user": "runOpts",
    });
  });

  it("skips undefined sources", () => {
    expect(mergeHeaders(undefined, { a: "1" }, undefined)).toEqual({ a: "1" });
    expect(mergeHeaders(undefined, undefined)).toEqual({});
  });

  it("accepts the various HeadersInit shapes", () => {
    expect(mergeHeaders(new Headers({ a: "1" }), [["b", "2"]])).toEqual({ a: "1", b: "2" });
  });
});
