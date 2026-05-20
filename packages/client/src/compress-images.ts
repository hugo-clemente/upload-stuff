import type { Options } from "browser-image-compression";
import imageCompression from "browser-image-compression";

export const compressImage = async (image: File, opts?: Options) => {
  const compressedImage = await imageCompression(image, {
    useWebWorker: true,
    preserveExif: false, // Strip metadata by default
    ...opts,
  });

  return compressedImage;
};
