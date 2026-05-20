export const acceptedFileTypes = {
  image: ["image/jpeg", "image/png", "image/gif", "image/webp"],
};
export type AcceptedFileType = keyof typeof acceptedFileTypes;

type FileSizeUnit = "B" | "KB" | "MB" | "GB" | "TB";
export type FileSize = `${number}${FileSizeUnit}`;

export const getFileSizeInBytes = (size: FileSize): number => {
  const firstLetterIndex = size.search(/(\D)/);
  const value = size.slice(0, firstLetterIndex);
  const unit = size.slice(firstLetterIndex);

  const valueNumber = parseInt(value, 10);

  const unitMap: Record<FileSizeUnit, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
  };
  return valueNumber * unitMap[unit as FileSizeUnit];
};
