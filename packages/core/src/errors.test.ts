import { describe, expect, it } from "vitest";

import { UploadStuffError } from "./errors";

describe("UploadStuffError", () => {
  it("maps INPUT_VALIDATION_ERROR to 400", () => {
    const err = new UploadStuffError({
      code: "INPUT_VALIDATION_ERROR",
      message: "bad input",
    });
    expect(err.status).toBe(400);
    expect(err.code).toBe("INPUT_VALIDATION_ERROR");
    expect(err.name).toBe("UploadStuffError");
  });

  it("maps UNAUTHORIZED to 401 and FORBIDDEN to 403", () => {
    expect(
      new UploadStuffError({ code: "UNAUTHORIZED", message: "x" }).status,
    ).toBe(401);
    expect(
      new UploadStuffError({ code: "FORBIDDEN", message: "x" }).status,
    ).toBe(403);
  });

  it("is an instanceof Error", () => {
    const err = new UploadStuffError({ code: "BAD_REQUEST", message: "x" });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(UploadStuffError);
  });
});
