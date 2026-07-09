import { match } from "ts-pattern";

/** How often progress is reported: `"all"` every event, `"fine"` per 1%, `"coarse"` per 10% (100% always fires). */
export type ProgressGranularity = "all" | "fine" | "coarse";

/**
 * Per-run progress accounting. Accumulates uploaded-byte deltas and reports
 * whole-run percentages through `onProgress`, throttled by granularity ("all"
 * every report, "fine" every 1%, "coarse" every 10%; 100 always reported).
 * State lives in the closure — create one reporter per upload run.
 */
export const createProgressReporter = ({
  totalBytes,
  granularity = "coarse",
  onProgress,
}: {
  totalBytes: number;
  granularity?: ProgressGranularity;
  onProgress?: (progressPercent: number) => void;
}) => {
  let uploadedBytes = 0;
  let lastReportedPercent = 0;

  return (extraUploadedBytes: number) => {
    uploadedBytes += extraUploadedBytes;
    const total = totalBytes || 1;
    const percent = Math.min(100, Math.round((uploadedBytes / total) * 100));

    if (granularity === "all") {
      onProgress?.(percent);
      lastReportedPercent = percent;
      return;
    }

    const step = match(granularity)
      .with("fine", () => 1)
      .with("coarse", () => 10)
      .exhaustive();

    if (
      percent === 100 ||
      percent - lastReportedPercent >= step ||
      Math.floor(percent / step) !== Math.floor(lastReportedPercent / step)
    ) {
      onProgress?.(percent);
      lastReportedPercent = percent;
    }
  };
};
