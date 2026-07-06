import { describe, expect, it, vi } from "vite-plus/test";

import { createProgressReporter } from "./progress";

describe("createProgressReporter", () => {
  it("coarse: reports only on 10% steps and always at 100", () => {
    const onProgress = vi.fn();
    const report = createProgressReporter({ totalBytes: 1000, granularity: "coarse", onProgress });
    report(40); // 4% — below the step, silent
    report(60); // 10%
    report(850); // 95%
    report(50); // 100%
    expect(onProgress.mock.calls.map(([p]) => p)).toEqual([10, 95, 100]);
  });

  it("fine: reports on every 1% change, skips sub-1% noise", () => {
    const onProgress = vi.fn();
    const report = createProgressReporter({ totalBytes: 1000, granularity: "fine", onProgress });
    report(10); // 1%
    report(2); // still ~1% — silent
    report(10); // 2%
    expect(onProgress.mock.calls.map(([p]) => p)).toEqual([1, 2]);
  });

  it("all: reports every call, even at an unchanged percent", () => {
    const onProgress = vi.fn();
    const report = createProgressReporter({ totalBytes: 1000, granularity: "all", onProgress });
    report(1); // rounds to 0%
    report(1); // still 0%
    expect(onProgress.mock.calls.map(([p]) => p)).toEqual([0, 0]);
  });

  it("defaults to coarse", () => {
    const onProgress = vi.fn();
    const report = createProgressReporter({ totalBytes: 1000, onProgress });
    report(40); // 4% — silent under coarse
    report(60); // 10%
    expect(onProgress.mock.calls.map(([p]) => p)).toEqual([10]);
  });

  it("caps at 100 when deltas overshoot the total", () => {
    const onProgress = vi.fn();
    const report = createProgressReporter({ totalBytes: 1000, granularity: "coarse", onProgress });
    report(1500);
    expect(onProgress).toHaveBeenCalledWith(100);
  });

  it("does not divide by zero when totalBytes is 0", () => {
    const onProgress = vi.fn();
    const report = createProgressReporter({ totalBytes: 0, granularity: "coarse", onProgress });
    report(5);
    expect(onProgress).toHaveBeenCalledWith(100);
    expect(onProgress).not.toHaveBeenCalledWith(Number.NaN);
  });
});
