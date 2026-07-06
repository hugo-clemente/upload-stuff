import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_MAX_FILE_SIZE,
  FALLBACK_CONTENT_TYPE,
  canonicalizeContentType,
  customMime,
  getAcceptFromRouteConfig,
  isCompressibleRasterImageContentType,
  matchFileType,
  normalizeContentType,
  normalizeRouteConfig,
  type PerTypeConfig,
} from "./file-types";

const base = { isPublic: false, usageContext: "doc" } as const;
const opts = { defaultMaxFileCount: 20, defaultMaxFileSize: DEFAULT_MAX_FILE_SIZE };

describe("normalizeContentType", () => {
  it("lowercases, trims, strips parameters, and falls back on empty input", () => {
    expect(normalizeContentType(" Image/PNG; charset=binary ")).toBe("image/png");
    expect(normalizeContentType("")).toBe(FALLBACK_CONTENT_TYPE);
    expect(normalizeContentType(undefined)).toBe(FALLBACK_CONTENT_TYPE);
    expect(normalizeContentType(null)).toBe(FALLBACK_CONTENT_TYPE);
    expect(normalizeContentType(" ; charset=utf-8")).toBe(FALLBACK_CONTENT_TYPE);
  });

  it("folds commas, control chars, and oversized types to the catch-all", () => {
    expect(normalizeContentType("image/png,text/html")).toBe(FALLBACK_CONTENT_TYPE);
    expect(normalizeContentType("image/png\r\nX-Injected: 1")).toBe(FALLBACK_CONTENT_TYPE);
    expect(normalizeContentType("image/pn\u0000g")).toBe(FALLBACK_CONTENT_TYPE);
    expect(normalizeContentType(`image/${"x".repeat(300)}`)).toBe(FALLBACK_CONTENT_TYPE);
    expect(normalizeContentType("application/vnd.acme.bundle+json")).toBe(
      "application/vnd.acme.bundle+json",
    );
  });
});

describe("canonicalizeContentType", () => {
  it("lowercases and strips parameters but does not fold malformed input", () => {
    expect(canonicalizeContentType(" Image/PNG; charset=x ")).toBe("image/png");
    expect(canonicalizeContentType("garbage")).toBe("garbage");
    expect(canonicalizeContentType("")).toBe("");
    expect(canonicalizeContentType(null)).toBe("");
    expect(canonicalizeContentType(undefined)).toBe("");
  });
});

describe("customMime", () => {
  it("normalizes a syntactically valid vendor MIME", () => {
    expect(customMime(" Application/VND.Acme.Bundle+JSON ")).toBe(
      "application/vnd.acme.bundle+json",
    );
  });

  it.each([
    "",
    "noslash",
    "a/b/c",
    "a/",
    "/b",
    "text/plain; charset=utf-8",
    "a b/c",
    "*/*",
    "image/*",
  ])("rejects %j", (value) => {
    expect(() => customMime(value)).toThrow(/invalid MIME type/i);
  });
});

describe("normalizeRouteConfig", () => {
  it("normalizes direct wildcards, MIME literals, array sugar, and fallback sizes", () => {
    const result = normalizeRouteConfig(
      {
        ...base,
        maxFileSize: "8MB",
        files: { "image/*": { maxFileSize: "2MB" }, "application/pdf": {}, blob: {} },
      },
      opts,
    );

    expect(result.files["image/*"]).toEqual({ maxFileSize: "2MB" });
    expect(result.files["application/pdf"]).toEqual({ maxFileSize: "8MB" });
    expect(result.files.blob).toEqual({ maxFileSize: "8MB" });
    expect(result.maxFileCount).toBe(20);
  });

  it("uses the instance size fallback when entry and route omit maxFileSize", () => {
    const result = normalizeRouteConfig({ ...base, files: ["text/plain"] }, opts);
    expect(result.files["text/plain"]!.maxFileSize).toBe("4MB");
  });

  it("preserves explicit route maxFileCount 0", () => {
    const result = normalizeRouteConfig({ ...base, files: ["image/*"], maxFileCount: 0 }, opts);
    expect(result.maxFileCount).toBe(0);
  });

  it("lowercases MIME keys and rejects duplicate normalized keys", () => {
    expect(
      normalizeRouteConfig({ ...base, files: { ["Image/PNG" as "image/png"]: {} } }, opts).files[
        "image/png"
      ],
    ).toBeDefined();
    expect(
      normalizeRouteConfig({ ...base, files: { ["Image/*" as "image/*"]: {} } }, opts).files[
        "image/*"
      ],
    ).toBeDefined();
    expect(() => normalizeRouteConfig({ ...base, files: ["Image/*" as "image/*", "image/*"] }, opts)).toThrow(
      /duplicate/i,
    );
  });

  it("throws on duplicate normalized keys in record form", () => {
    const filesRecord = {} as Partial<Record<string, PerTypeConfig>>;
    filesRecord["Image/*"] = {};
    filesRecord["image/*"] = {};
    expect(() =>
      normalizeRouteConfig(
        { ...base, files: filesRecord },
        opts,
      ),
    ).toThrow(/duplicate/i);
  });

  it("rejects empty configs, malformed keys, invalid sizes, and invalid counts", () => {
    expect(() => normalizeRouteConfig({ ...base, files: [] }, opts)).toThrow(/at least one/i);
    expect(() => normalizeRouteConfig({ ...base, files: {} }, opts)).toThrow(/at least one/i);
    expect(() =>
      normalizeRouteConfig({ ...base, files: undefined as never }, opts),
    ).toThrow(/at least one/i);
    expect(() => normalizeRouteConfig({ ...base, files: null as never }, opts)).toThrow(
      /at least one/i,
    );
    for (const key of [
      "noslash",
      "a/b/c",
      "text/plain; charset=utf-8",
      "*/*",
      "image/png,text/html",
      "image/pn g",
    ]) {
      expect(() =>
        normalizeRouteConfig({ ...base, files: { [key as "image/png"]: {} } }, opts),
      ).toThrow(/invalid file type key/i);
    }
    expect(() =>
      normalizeRouteConfig({ ...base, files: { ["image" as "image/*"]: {} } }, opts),
    ).toThrow(/did you mean "image\/\*"/i);
    expect(() =>
      normalizeRouteConfig({ ...base, files: { ["image/png*" as "image/png"]: {} } }, opts),
    ).toThrow(/invalid file type key/i);
    expect(() =>
      normalizeRouteConfig({ ...base, files: { "image/*": { maxFileSize: "0B" } } }, opts),
    ).toThrow(/maxFileSize/);
    expect(() =>
      normalizeRouteConfig({ ...base, files: { "image/*": { maxFileCount: -1 } } }, opts),
    ).toThrow(/maxFileCount/);
    expect(() =>
      normalizeRouteConfig({ ...base, files: ["image/*"], maxFileCount: 1.5 }, opts),
    ).toThrow(/maxFileCount/);
    expect(() =>
      normalizeRouteConfig({ ...base, files: ["image/*"] }, { ...opts, defaultMaxFileCount: -1 }),
    ).toThrow(/defaultMaxFileCount/);
    expect(() =>
      normalizeRouteConfig({ ...base, files: ["image/*"] }, { ...opts, defaultMaxFileSize: "0B" }),
    ).toThrow(/defaultMaxFileSize/);
  });

  it.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
    "throws on prototype-colliding key %j",
    (key) => {
      expect(() =>
        normalizeRouteConfig({ ...base, files: { [key as "image/png"]: {} } }, opts),
      ).toThrow(/invalid file type key/i);
    },
  );
});

describe("matchFileType", () => {
  const config = normalizeRouteConfig(
    { ...base, files: { "image/*": {}, "image/png": { maxFileSize: "10MB" }, blob: {} } },
    opts,
  );

  it("uses exact, then wildcard, then blob precedence", () => {
    expect(matchFileType("Image/PNG; charset=binary", config)?.key).toBe("image/png");
    expect(matchFileType("image/jpeg", config)?.key).toBe("image/*");
    expect(matchFileType("application/x-unknown", config)?.key).toBe("blob");
  });

  it("returns undefined when no bucket matches", () => {
    const noBlob = normalizeRouteConfig({ ...base, files: ["image/*"] }, opts);
    expect(matchFileType("application/pdf", noBlob)).toBeUndefined();
  });

  it("returns undefined for prototype-colliding content types", () => {
    const noBlob = normalizeRouteConfig({ ...base, files: ["image/*"] }, opts);
    expect(matchFileType("constructor", noBlob)).toBeUndefined();
    expect(matchFileType("__proto__", noBlob)).toBeUndefined();
  });

  it("treats malformed content types as ineligible for exact/wildcard buckets", () => {
    const imageAndPdf = normalizeRouteConfig({ ...base, files: ["image/*", "application/pdf"] }, opts);
    expect(matchFileType("image", imageAndPdf)).toBeUndefined();
    expect(matchFileType("image/png/extra", imageAndPdf)).toBeUndefined();
    expect(matchFileType("image/", imageAndPdf)).toBeUndefined();

    const blobOnly = normalizeRouteConfig({ ...base, files: ["blob"] }, opts);
    expect(matchFileType("image", blobOnly)?.key).toBe("blob");
  });

  it("folds a control-char content type to blob rather than a wildcard bucket", () => {
    const cfg = normalizeRouteConfig(
      { ...base, files: { "image/*": { maxFileSize: "5MB" }, blob: {} } },
      opts,
    );
    expect(matchFileType("image/png\r\nX-Injected: 1", cfg)?.key).toBe("blob");
  });

  it("matches a declared customMime literal end-to-end", () => {
    const custom = customMime("application/vnd.acme.bundle+json");
    const cfg = normalizeRouteConfig({ ...base, files: { [custom]: { maxFileSize: "2MB" } } }, opts);
    expect(matchFileType("application/vnd.acme.bundle+json", cfg)?.key).toBe(custom);
    expect(matchFileType("application/vnd.acme.bundle+json", cfg)?.config.maxFileSize).toBe("2MB");
  });

  it("routes untyped or malformed content to blob only, never a typed wildcard", () => {
    const appWildcard = normalizeRouteConfig({ ...base, files: ["application/*"] }, opts);
    // a genuine application subtype still matches the wildcard
    expect(matchFileType("application/octet-stream", appWildcard)?.key).toBe("application/*");
    // but empty/malformed content must not ride the typed wildcard - it requires blob
    expect(matchFileType("", appWildcard)).toBeUndefined();
    expect(matchFileType("garbage", appWildcard)).toBeUndefined();
    expect(matchFileType("image/png\r\nX-Injected: 1", appWildcard)).toBeUndefined();

    const withBlob = normalizeRouteConfig({ ...base, files: ["application/*", "blob"] }, opts);
    expect(matchFileType("", withBlob)?.key).toBe("blob");
    expect(matchFileType("garbage", withBlob)?.key).toBe("blob");
  });
});

describe("getAcceptFromRouteConfig", () => {
  it("joins normalized keys unless blob is present", () => {
    const config = normalizeRouteConfig({ ...base, files: { "image/*": {}, "application/pdf": {} } }, opts);
    expect(getAcceptFromRouteConfig(config)!.split(",").sort()).toEqual([
      "application/pdf",
      "image/*",
    ]);
    expect(getAcceptFromRouteConfig(normalizeRouteConfig({ ...base, files: ["blob"] }, opts))).toBeUndefined();
    expect(
      getAcceptFromRouteConfig(
        normalizeRouteConfig({ ...base, files: { blob: {}, "application/pdf": {} } }, opts),
      ),
    ).toBeUndefined();
  });
});

describe("isCompressibleRasterImageContentType", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])("accepts %s", (contentType) => {
    expect(isCompressibleRasterImageContentType(contentType)).toBe(true);
  });

  it.each(["image/gif", "image/svg+xml", "application/pdf", "video/mp4", ""])(
    "rejects %s",
    (contentType) => {
      expect(isCompressibleRasterImageContentType(contentType)).toBe(false);
    },
  );
});
