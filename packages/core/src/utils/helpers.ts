export const DEFAULT_BASE_PATH = "/api/upload-stuff";

export const acceptedFileTypes = {
  image: ["image/jpeg", "image/png", "image/gif", "image/webp"],
};
export type AcceptedFileType = keyof typeof acceptedFileTypes;

export const getValidMimeTypes = (type: AcceptedFileType | AcceptedFileType[]): string[] => {
  const types = Array.isArray(type) ? type : [type];
  return types.flatMap((t) => acceptedFileTypes[t]);
};

type FileSizeUnit = "B" | "KB" | "MB" | "GB" | "TB";
export type FileSize = `${number}${FileSizeUnit}`;

const fileSizeUnitMap: Record<FileSizeUnit, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
  TB: 1024 * 1024 * 1024 * 1024,
};

export const getFileSizeInBytes = (size: FileSize): number => {
  // Search for the first letter (not the first non-digit): a fractional size
  // like "1.5MB" must split on the "M", not the ".".
  const firstLetterIndex = size.search(/[A-Za-z]/);
  const value = parseFloat(size.slice(0, firstLetterIndex));
  const multiplier = fileSizeUnitMap[size.slice(firstLetterIndex) as FileSizeUnit];

  if (!Number.isFinite(value) || multiplier === undefined) {
    // A malformed size is a developer config error. Throwing keeps it loud —
    // returning NaN would make every size comparison silently pass.
    throw new Error(`Invalid file size: "${size}"`);
  }

  return Math.floor(value * multiplier);
};
