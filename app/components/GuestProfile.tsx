"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { authenticatedFetch } from "@/lib/guest-auth";

type Profile = {
  username: string | null;
  loading: boolean;
  error: string;
  saveUsername: (name: string) => Promise<void>;
};

const ProfileContext = createContext<Profile | null>(null);

function cacheName(name: string | null) {
  try {
    if (name) localStorage.setItem("username", name);
    else localStorage.removeItem("username");
  } catch {
    // Redis is the source of truth even when browser storage is unavailable.
  }
}

export function GuestProfileProvider({ children }: { children: React.ReactNode }) {
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await authenticatedFetch("/api/profile");
        const data = await response.json();
        if (!active) return;
        if (!response.ok) throw new Error(data.error || "Unable to load your saved name.");
        // Preserve names saved by the earlier browser-only version of the app.
        let cached: string | null = null;
        try { cached = localStorage.getItem("username")?.trim() ?? null; } catch {}
        if (!data.username && cached && cached.length <= 100) {
          const migration = await authenticatedFetch("/api/profile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: cached }),
          });
          const migrated = await migration.json();
          if (!active) return;
          if (!migration.ok) throw new Error(migrated.error || "Unable to save your existing name.");
          data.username = migrated.username;
        }
        setUsername(data.username);
        cacheName(data.username);
        setError("");
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Unable to load your saved name.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const sync = (event: StorageEvent) => {
      if (event.key === "username" || event.key === null) void load();
    };
    window.addEventListener("storage", sync);
    return () => { active = false; window.removeEventListener("storage", sync); };
  }, []);

  const saveUsername = useCallback(async (name: string) => {
    const response = await authenticatedFetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: name }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Your name could not be saved. Please try again.");
    setUsername(data.username);
    cacheName(data.username);
    setError("");
  }, []);

  return (
    <ProfileContext.Provider value={{ username, loading, error, saveUsername }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useGuestProfile() {
  const profile = useContext(ProfileContext);
  if (!profile) throw new Error("GuestProfileProvider is required");
  return profile;
}

export function AppHeader() {
  const { username, loading, error } = useGuestProfile();
  return (
    <header className="border-b border-gray-200 bg-white px-6 py-4 text-black">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4">
        <Link href="/dashboard" className="text-lg font-bold tracking-tight">Ranked Debate</Link>
        <div aria-label="Guest profile" className="flex min-w-0 items-center gap-3">
          <div aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${username ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-500"}`}>
            {username ? Array.from(username).slice(0, 2).join("").toUpperCase() : "?"}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500">{username ? "Saved as" : "Guest profile"}</p>
            <p className="max-w-64 truncate text-sm font-semibold" title={username ?? undefined}>
              {loading ? "Loading profile..." : username || (error ? "Profile unavailable" : "Name not saved yet")}
            </p>
          </div>
          {username && <span aria-label="Name saved" className="text-emerald-700">✓</span>}
        </div>
      </div>
    </header>
  );
}
