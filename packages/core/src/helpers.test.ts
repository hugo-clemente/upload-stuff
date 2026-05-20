import { describe, expect, it } from "vitest";

import { getFileSizeInBytes } from "./utils/helpers";

describe("getFileSizeInBytes", () => {
  it("parses MB", () => {
    expect(getFileSizeInBytes("10MB")).toBe(10 * 1024 * 1024);
  });

  it("parses KB", () => {
    expect(getFileSizeInBytes("500KB")).toBe(500 * 1024);
  });

  it("parses raw bytes", () => {
    expect(getFileSizeInBytes("0B")).toBe(0);
    expect(getFileSizeInBytes("1B")).toBe(1);
  });

  it("parses GB and TB", () => {
    expect(getFileSizeInBytes("2GB")).toBe(2 * 1024 ** 3);
    expect(getFileSizeInBytes("1TB")).toBe(1024 ** 4);
  });
});
