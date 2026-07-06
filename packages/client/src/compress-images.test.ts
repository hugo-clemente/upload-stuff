import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import imageCompression from "browser-image-compression";

import { DEFAULT_MAX_FILE_SIZE, normalizeRouteConfig } from "@upload-stuff/core";

import { preprocessImages } from "./compress-images";

// Mock the underlying library, not `compressImage`: preprocessImages and compressImage
// live in the same module, so stubbing the module would also stub the function under test.
vi.mock("browser-image-compression", () => ({
  default: vi.fn(async (file: File) => file),
}));
const compress = vi.mocked(imageCompression);

const opts = { defaultMaxFileCount: 20, defaultMaxFileSize: DEFAULT_MAX_FILE_SIZE };
const config = normalizeRouteConfig(
  {
    isPublic: false,
    usageContext: "doc",
    files: { "image/*": { maxFileSize: "1MB" }, "application/pdf": { maxFileSize: "16MB" } },
  },
  opts,
);
const pdfOnly = normalizeRouteConfig(
  { isPublic: false, usageContext: "doc", files: ["application/pdf"] },
  opts,
);

const makeFile = (name: string, type: string) => new File([new Uint8Array(64)], name, { type });

beforeEach(() => {
  compress.mockClear();
});

describe("preprocessImages", () => {
  it("passes through PDF, SVG, GIF, and unknown files by identity", async () => {
    const preprocess = preprocessImages();
    const files = [
      makeFile("a.pdf", "application/pdf"),
      makeFile("b.svg", "image/svg+xml"),
      makeFile("c.gif", "image/gif"),
      makeFile("d.bin", ""),
    ];

    const result = await preprocess!({ files, config });

    expect(result).toHaveLength(files.length);
    result.forEach((file, index) => expect(file).toBe(files[index]));
    expect(compress).not.toHaveBeenCalled();
  });

  it("compresses JPEG/PNG/WebP using the matched bucket size", async () => {
    const preprocess = preprocessImages();
    const png = makeFile("a.png", "image/png");

    await preprocess!({ files: [png], config });

    expect(compress).toHaveBeenCalledWith(png, expect.objectContaining({ maxSizeMB: 1 }));
  });

  it("passes a compressible image through unchanged when no bucket matches", async () => {
    const preprocess = preprocessImages();
    const png = makeFile("a.png", "image/png");

    const [result] = await preprocess!({ files: [png], config: pdfOnly });

    expect(result).toBe(png);
    expect(compress).not.toHaveBeenCalled();
  });

  it("resizes without a size cap when maxWidthOrHeight is set but no bucket matches", async () => {
    const preprocess = preprocessImages(800);
    const png = makeFile("a.png", "image/png");

    await preprocess!({ files: [png], config: pdfOnly });

    expect(compress).toHaveBeenCalledWith(
      png,
      expect.objectContaining({ maxWidthOrHeight: 800, maxSizeMB: undefined }),
    );
  });
});
