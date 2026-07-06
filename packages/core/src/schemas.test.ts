import { describe, expect, it } from "vite-plus/test";

import {
  completeUploadRequestSchema,
  initUploadFileSchema,
  initUploadRequestSchema,
  uploadedFileSchema,
} from "./schemas";

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

describe("wire request schemas", () => {
  it("accepts a valid init-upload body", () => {
    const body = {
      files: [{ filename: "a.png", contentType: "image/png", size: 10 }],
      input: null,
    };
    expect(initUploadRequestSchema.safeParse(body).success).toBe(true);
  });

  it("rejects init-upload bodies with a bad files shape", () => {
    expect(initUploadRequestSchema.safeParse({ files: {}, input: null }).success).toBe(false);
    expect(initUploadRequestSchema.safeParse({ input: null }).success).toBe(false);
  });

  it("accepts a valid complete-upload body and rejects a missing token", () => {
    expect(completeUploadRequestSchema.safeParse({ batchToken: "t" }).success).toBe(true);
    expect(completeUploadRequestSchema.safeParse({}).success).toBe(false);
  });
});
