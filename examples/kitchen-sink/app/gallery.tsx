"use client";

import { useEffect, useState } from "react";

type Row = {
  id: string;
  filename: string;
  caption: string | null;
  scope: string | null;
  contentType: string;
  publicUrl: string;
  createdAt: string;
};

export function Gallery({ user, refreshKey }: { user: string; refreshKey: number }) {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/files", { headers: { "x-user-id": user } })
      .then((r) => r.json())
      .then((d: { files: Row[] }) => {
        if (active) setRows(d.files);
      })
      .catch(() => {
        if (active) setRows([]);
      });
    return () => {
      active = false;
    };
  }, [user, refreshKey]);

  return (
    <div className="card">
      <h2>{user}&apos;s stored files ({rows.length})</h2>
      {rows.length === 0 && <p>No files yet for this user.</p>}
      {rows.map((row) => (
        <div key={row.id} className="row" style={{ marginBlock: "0.75rem" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="preview" src={row.publicUrl} alt={row.filename} style={{ maxWidth: 120 }} />
          <pre>
            {JSON.stringify(
              { caption: row.caption, scope: row.scope, contentType: row.contentType },
              null,
              2,
            )}
          </pre>
        </div>
      ))}
    </div>
  );
}
