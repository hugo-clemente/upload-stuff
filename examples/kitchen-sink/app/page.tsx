"use client";

import { useState } from "react";

import { USERS, type UserId } from "@/lib/users";
import { UploadPanel } from "./upload-panel";
import { Gallery } from "./gallery";
import { HijackPanel } from "./hijack-panel";

export default function Page() {
  const [user, setUser] = useState<UserId>("user-a");
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <main>
      <h1>upload-stuff — kitchen sink</h1>
      <p>Local MinIO + Postgres. Identity is the selected user, sent as an x-user-id header.</p>

      <div className="card">
        <strong>Current user:</strong>
        <div className="row" style={{ marginTop: "0.5rem" }}>
          {USERS.map((u) => (
            <button key={u} aria-pressed={u === user} onClick={() => setUser(u)}>
              {u}
            </button>
          ))}
        </div>
      </div>

      <UploadPanel user={user} onUploaded={() => setRefreshKey((k) => k + 1)} />
      <Gallery user={user} refreshKey={refreshKey} />
      <HijackPanel />
    </main>
  );
}
