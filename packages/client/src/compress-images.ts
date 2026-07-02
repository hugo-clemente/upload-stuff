import type { Options } from "browser-image-compression";
import imageCompression from "browser-image-compression";

import type { AnyFileRoute } from "@upload-stuff/core";
import { getFileSizeInBytes } from "@upload-stuff/core";

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
    const maxSize = config?.maxFileSize;

    if (!maxSize && !maxWidthOrHeight) {
      return files;
    }

    const maxSizeBytes = maxSize ? getFileSizeInBytes(maxSize) : undefined;
    const maxSizeMB = maxSizeBytes ? maxSizeBytes / 1024 / 1024 : undefined;

    return Promise.all(
      files.map((file) => {
        return compressImage(file, { maxWidthOrHeight, maxSizeMB });
      }),
    );
  };
