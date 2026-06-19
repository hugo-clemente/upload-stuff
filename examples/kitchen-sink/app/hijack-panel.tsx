"use client";

import { useState } from "react";

// A 1x1 transparent PNG (70 bytes) used as the in-flight payload.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function pngFile() {
  const bytes = Uint8Array.from(atob(PNG_BASE64), (c) => c.charCodeAt(0));
  return new File([bytes], "hijack.png", { type: "image/png" });
}

export function HijackPanel() {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const append = (line: string) => setLog((l) => [...l, line]);

  async function run() {
    setBusy(true);
    setLog([]);
    try {
      const file = pngFile();

      // 1. init the batch as user-a
      const initRes = await fetch("/api/upload-stuff/image/init-upload", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "user-a" },
        body: JSON.stringify({
          input: { caption: "hijack test" },
          files: [{ filename: file.name, contentType: file.type, size: file.size }],
        }),
      });
      const initData = await initRes.json();
      const plan = initData.files[0];
      append(`1. init as user-a → batchId ${initData.batchId}`);

      // 2. upload the bytes to MinIO (replaying the signed metadata headers)
      await fetch(plan.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type, ...(plan.uploadHeaders ?? {}) },
        body: file,
      });
      append("2. uploaded bytes to storage");

      // 3. try to complete as user-b — the scope guard must reject this
      const bRes = await fetch("/api/upload-stuff/image/complete-upload", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "user-b" },
        body: JSON.stringify({ batchId: initData.batchId }),
      });
      const bBody = await bRes.json();
      append(
        `3. complete as user-b → HTTP ${bRes.status} ${
          bRes.ok ? "OK (UNEXPECTED!)" : "rejected ✓"
        } ${JSON.stringify(bBody)}`,
      );

      // 4. complete as the real owner — must succeed
      const aRes = await fetch("/api/upload-stuff/image/complete-upload", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "user-a" },
        body: JSON.stringify({ batchId: initData.batchId }),
      });
      const aBody = await aRes.json();
      append(
        `4. complete as user-a → HTTP ${aRes.status} ${
          aRes.ok ? "success ✓" : "FAILED (UNEXPECTED!)"
        } ${JSON.stringify(aBody)}`,
      );
    } catch (e) {
      append(`error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Ownership guard (hijack attempt)</h2>
      <p>
        Init a batch as <code>user-a</code>, upload bytes, then try to finalize it as{" "}
        <code>user-b</code> (must fail) and as <code>user-a</code> (must succeed).
      </p>
      <button onClick={() => void run()} disabled={busy}>
        {busy ? "running…" : "Run hijack attempt"}
      </button>
      {log.length > 0 && <pre>{log.join("\n")}</pre>}
    </div>
  );
}
