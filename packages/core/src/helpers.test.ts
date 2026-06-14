import { describe, expect, it } from "vite-plus/test";

import { getFileSizeInBytes, type FileSize } from "./utils/helpers";

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

  it("parses fractional sizes", () => {
    expect(getFileSizeInBytes("1.5MB")).toBe(Math.floor(1.5 * 1024 * 1024));
    expect(getFileSizeInBytes("0.5KB")).toBe(512);
  });

  it("throws on malformed sizes", () => {
    expect(() => getFileSizeInBytes("MB" as FileSize)).toThrowError(/Invalid file size/);
    expect(() => getFileSizeInBytes("1.5XB" as FileSize)).toThrowError(/Invalid file size/);
    expect(() => getFileSizeInBytes("100" as FileSize)).toThrowError(/Invalid file size/);
  });
});
