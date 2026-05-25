import { describe, expect, it } from "vite-plus/test";

import { initUploadFileSchema, uploadedFileSchema } from "./schemas";

describe("initUploadFileSchema", () => {
  it("accepts a valid init-upload file", () => {
    const result = initUploadFileSchema.safeParse({
      filename: "photo.png",
      contentType: "image/png",
      size: 1024,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing size", () => {
    const result = initUploadFileSchema.safeParse({
      filename: "photo.png",
      contentType: "image/png",
    });
    expect(result.success).toBe(false);
  });
});

describe("uploadedFileSchema", () => {
  it("accepts a valid uploaded file with optional publicUrl omitted", () => {
    const result = uploadedFileSchema.safeParse({
      filename: "photo.png",
      contentType: "image/png",
      size: 1024,
      id: "abc",
      key: "abc-photo.png",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing key", () => {
    const result = uploadedFileSchema.safeParse({
      filename: "photo.png",
      contentType: "image/png",
      size: 1024,
      id: "abc",
    });
    expect(result.success).toBe(false);
  });
});
