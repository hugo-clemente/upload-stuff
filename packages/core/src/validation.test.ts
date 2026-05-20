import { describe, expect, it } from "vitest";

import { UploadStuffError } from "./errors";
import type { AnyRouteConfig } from "./router-types";
import type { InitUploadFileData } from "./schemas";
import { validateFiles } from "./validation";

const config: AnyRouteConfig = {
  isPublic: false,
  type: "image",
  usageContext: "avatars",
  maxFileSize: "5MB",
  maxFileCount: 2,
};

const file = (
  overrides: Partial<InitUploadFileData> = {},
): InitUploadFileData => ({
  filename: "photo.png",
  contentType: "image/png",
  size: 1024,
  ...overrides,
});

describe("validateFiles", () => {
  it("accepts valid files", () => {
    expect(() => validateFiles([file(), file()], config)).not.toThrow();
  });

  it("rejects too many files", () => {
    expect(() =>
      validateFiles([file(), file(), file()], config),
    ).toThrowError(UploadStuffError);
  });

  it("rejects a file over maxFileSize", () => {
    expect(() =>
      validateFiles([file({ size: 6 * 1024 * 1024 })], config),
    ).toThrowError(UploadStuffError);
  });

  it("rejects an unsupported content type", () => {
    expect(() =>
      validateFiles([file({ contentType: "application/pdf" })], config),
    ).toThrowError(UploadStuffError);
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
