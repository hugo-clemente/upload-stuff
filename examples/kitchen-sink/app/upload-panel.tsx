"use client";

import { useState } from "react";

import { useUploadStuff } from "@/lib/upload-stuff-client";

export function UploadPanel({ user, onUploaded }: { user: string; onUploaded: () => void }) {
  const [caption, setCaption] = useState("");
  const [serverData, setServerData] = useState<{ owner: string; count: number } | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { startUpload, isUploading, isLoading, accept, progress, abort } = useUploadStuff((r) => r.image, {
    headers: { "x-user-id": user },
    uploadProgressGranularity: "fine",
    onClientUploadComplete: (res) => {
      setServerData(res.serverData ?? null);
      setImageUrl(res.files[0]?.publicUrl ?? null);
      onUploaded();
    },
    onUploadError: (e) => setError(e.message),
  });

  return (
    <div className="card">
      <h2>Upload an image (as {user})</h2>
      <div className="row">
        <input
          type="text"
          placeholder="caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
        />
        <input
          type="file"
          accept={accept}
          disabled={isUploading || isLoading}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length === 0) return;
            setError(null);
            setServerData(null);
            setImageUrl(null);
            void startUpload(files, { caption });
          }}
        />
      </div>

      {isUploading && (
        <>
          <div className="bar" aria-label="upload progress">
            <span style={{ width: `${progress}%` }} />
          </div>
          <button type="button" onClick={abort}>
            Cancel
          </button>
        </>
      )}

      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}

      {serverData && (
        <pre>onUploadComplete serverData → {JSON.stringify(serverData, null, 2)}</pre>
      )}

      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="preview" src={imageUrl} alt="uploaded" />
      )}
    </div>
  );
}
