import { describe, expect, it } from "vite-plus/test";

import { resolveEndpoint } from "./endpoint";

type Router = { image: unknown; document: unknown };

describe("resolveEndpoint", () => {
  it("passes plain string endpoints through", () => {
    expect(resolveEndpoint<Router, "image">("image")).toBe("image");
  });

  it("resolves a selector function to the accessed route key", () => {
    expect(resolveEndpoint<Router, "document">((r) => r.document)).toBe("document");
  });
});
