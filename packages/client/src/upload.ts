export const uploadFileWithProgress = async ({
  uploadUrl,
  uploadHeaders,
  file,
  contentType,
  onProgress,
  onInitXhr,
  signal,
}: {
  uploadUrl: string;
  uploadHeaders?: Record<string, string>;
  file: File;
  contentType: string;
  onProgress?: (uploadedBytes: number) => void;
  onInitXhr?: (xhr: XMLHttpRequest) => void;
  signal?: AbortSignal;
}) => {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    // The server signed and stored this exact value; sending anything else (e.g. the raw
    // file.type) would fail the presigned signature check and S3 verifyUpload.
    xhr.setRequestHeader("Content-Type", contentType);
    // Replay any signed headers (e.g. `x-amz-meta-*`) the storage adapter
    // required, otherwise the presigned signature check rejects the PUT.
    if (uploadHeaders) {
      for (const [name, value] of Object.entries(uploadHeaders)) {
        xhr.setRequestHeader(name, value);
      }
    }

    let onAbort: (() => void) | undefined;
    const cleanup = () => {
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    };
    const settle = (fn: () => void) => {
      cleanup();
      fn();
    };

    if (onInitXhr) onInitXhr(xhr);
    if (signal) {
      if (signal.aborted) {
        try {
          xhr.abort();
        } catch {
          //do nothing
        }
        return reject(new Error("Upload aborted"));
      }
      onAbort = () => {
        try {
          xhr.abort();
        } catch {
          //do nothing
        }
        settle(() => reject(new Error("Upload aborted")));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.loaded);
      }
    };

    xhr.onerror = () => settle(() => reject(new Error("Upload failed")));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        return settle(resolve);
      }
      settle(() => reject(new Error(`Upload failed (${xhr.status})`)));
    };

    xhr.send(file);
  });
};
