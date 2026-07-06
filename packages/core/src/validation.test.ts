import { describe, expect, it } from "vite-plus/test";

import { UploadStuffError } from "./errors";
import { normalizeRouteConfig, type NormalizedRouteConfig } from "./file-types";
import type { InitUploadFileData } from "./schemas";
import { validateFiles } from "./validation";

const normalize = (
  config: Parameters<typeof normalizeRouteConfig>[0],
): NormalizedRouteConfig =>
  normalizeRouteConfig(config, {
    defaultMaxFileCount: 20,
    defaultMaxFileSize: "4MB",
  });

const config = normalize({
  isPublic: false,
  usageContext: "avatars",
  files: ["image/*"],
  maxFileSize: "5MB",
  maxFileCount: 2,
});

const file = (overrides: Partial<InitUploadFileData> = {}): InitUploadFileData => ({
  filename: "photo.png",
  contentType: "image/png",
  size: 1024,
  ...overrides,
});

describe("validateFiles", () => {
  it("accepts supported files", () => {
    expect(() => validateFiles([file(), file()], config)).not.toThrow();
  });

  it("rejects unsupported files", () => {
    expect(() => validateFiles([file({ contentType: "application/pdf" })], config)).toThrowError(
      UploadStuffError,
    );
  });

  it("enforces per-entry size limits", () => {
    const normalized = normalize({
      isPublic: false,
      usageContext: "mixed",
      files: {
        "image/*": { maxFileSize: "5MB" },
        "application/pdf": { maxFileSize: "1MB" },
      },
    });

    expect(() =>
      validateFiles([file({ filename: "doc.pdf", contentType: "application/pdf", size: 2 * 1024 * 1024 })], normalized),
    ).toThrowError(/exceeds maximum size of 1MB/);
  });

  it("enforces per-entry count limits", () => {
    const normalized = normalize({
      isPublic: false,
      usageContext: "mixed",
      files: { "image/*": { maxFileCount: 1 } },
      maxFileCount: 10,
    });

    expect(() => validateFiles([file(), file({ filename: "b.png" })], normalized)).toThrowError(
      /Too many files of type image\/\*/,
    );
  });

  it("counts exact and wildcard buckets separately", () => {
    const normalized = normalize({
      isPublic: false,
      usageContext: "mixed",
      files: {
        "image/png": { maxFileCount: 1 },
        "image/*": { maxFileCount: 1 },
      },
      maxFileCount: 10,
    });

    expect(() =>
      validateFiles(
        [
          file({ filename: "a.png", contentType: "image/png" }),
          file({ filename: "b.jpg", contentType: "image/jpeg" }),
        ],
        normalized,
      ),
    ).not.toThrow();

    expect(() =>
      validateFiles(
        [
          file({ filename: "a.png", contentType: "image/png" }),
          file({ filename: "b.png", contentType: "image/png" }),
        ],
        normalized,
      ),
    ).toThrowError(/Too many files of type image\/png/);
  });

  it("enforces the route batch cap", () => {
    expect(() => validateFiles([file(), file(), file()], config)).toThrowError(
      /Too many files. Maximum allowed: 2/,
    );
  });

  it("rejects any file when maxFileCount is 0", () => {
    const normalized = normalize({
      isPublic: false,
      usageContext: "avatars",
      files: ["image/*"],
      maxFileCount: 0,
    });

    expect(() => validateFiles([file()], normalized)).toThrowError(
      /Too many files. Maximum allowed: 0/,
    );
  });

  it("falls back application/octet-stream through a blob route", () => {
    const normalized = normalize({
      isPublic: false,
      usageContext: "raw",
      files: ["blob"],
      maxFileSize: "1MB",
    });

    expect(() =>
      validateFiles([file({ filename: "raw.bin", contentType: "application/octet-stream" })], normalized),
    ).not.toThrow();
  });

  it("throws BAD_REQUEST on rejection", () => {
    try {
      validateFiles([file({ contentType: "application/pdf" })], config);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UploadStuffError);
      expect((e as UploadStuffError).code).toBe("BAD_REQUEST");
    }
  });
});
