"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;
type ParticipantSession = { user: { id: string }; access_token?: string };
let pendingSession: Promise<ParticipantSession> | undefined;

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return undefined;
  return (client ??= createClient(url, key));
}

export function getGuestSession(): Promise<ParticipantSession> {
  // Share initialization across components, including React's development effect replay.
  if (!pendingSession) {
    pendingSession = (async () => {
      const supabase = getClient();
      if (supabase) {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw new Error("Unable to restore your session. Please reload.");
        if (data.session) return data.session;
      }
      const response = await fetch("/api/session", { method: "POST", cache: "no-store" });
      if (!response.ok) throw new Error("Unable to create a guest session. Please retry.");
      return response.json();
    })().finally(() => { pendingSession = undefined; });
  }
  return pendingSession;
}

export async function authenticatedFetch(url: string, init: RequestInit = {}) {
  const session = await getGuestSession();
  const headers = new Headers(init.headers);
  if (session.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  return fetch(url, { ...init, headers, cache: "no-store" });
}
