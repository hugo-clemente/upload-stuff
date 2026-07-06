import type { Options } from "browser-image-compression";
import imageCompression from "browser-image-compression";

import type { AnyFileRoute } from "@upload-stuff/core";
import {
  getFileSizeInBytes,
  isCompressibleRasterImageContentType,
  matchFileType,
  normalizeContentType,
} from "@upload-stuff/core";

import type { UploadCallbacks } from "./types";

export const compressImage = async (image: File, opts?: Options) => {
  const compressedImage = await imageCompression(image, {
    useWebWorker: true,
    preserveExif: false, // Strip metadata by default
    ...opts,
  });

  return compressedImage;
};

export const preprocessImages =
  (maxWidthOrHeight?: number): UploadCallbacks<AnyFileRoute>["onBeforeUploadBegin"] =>
  async ({ files, config }) => {
    return Promise.all(
      files.map(async (file) => {
        const contentType = normalizeContentType(file.type);
        // Only raster formats browser-image-compression can actually re-encode; GIF/SVG/PDF
        // and unknown types pass through untouched.
        if (!isCompressibleRasterImageContentType(contentType)) return file;

        // Size to the bucket this file will actually be validated against. With no match and
        // no explicit dimension cap there's nothing to do, so skip the re-encode.
        const matched = matchFileType(contentType, config);
        if (!matched && !maxWidthOrHeight) return file;

        const maxSizeBytes = matched ? getFileSizeInBytes(matched.config.maxFileSize) : undefined;
        const maxSizeMB = maxSizeBytes ? maxSizeBytes / 1024 / 1024 : undefined;

        return compressImage(file, { maxWidthOrHeight, maxSizeMB });
      }),
    );
  };
