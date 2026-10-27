"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;
type ParticipantSession = { user: { id: string }; access_token?: string };
let pendingSession: Promise<ParticipantSession> | undefined;
let authIdentity: string | null | undefined;

export function getAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return undefined;
  return (client ??= createClient(url, key));
}

export function notifySessionChanged(nextIdentity?: string | null) {
  if (nextIdentity === undefined || nextIdentity !== authIdentity) pendingSession = undefined;
  if (nextIdentity !== undefined) authIdentity = nextIdentity;
  window.dispatchEvent(new Event("debate:session"));
}

export function getGuestSession(): Promise<ParticipantSession> {
  // Share initialization across components, including React's development effect replay.
  if (!pendingSession) {
    const initialization = (async () => {
      const supabase = getAuthClient();
      if (supabase) {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw new Error("Unable to restore your session. Please reload.");
        if (authIdentity === undefined) authIdentity = data.session?.user.id ?? null;
        if (data.session) return data.session;
      }
      const response = await fetch("/api/session", { method: "POST", cache: "no-store" });
      if (!response.ok) throw new Error("Unable to create a guest session. Please retry.");
      return response.json();
    })();
    const guarded = initialization.finally(() => { if (pendingSession === guarded) pendingSession = undefined; });
    pendingSession = guarded;
  }
  return pendingSession;
}

export async function authenticatedFetch(url: string, init: RequestInit = {}) {
  const session = await getGuestSession();
  const headers = new Headers(init.headers);
  if (session.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  return fetch(url, { ...init, headers, cache: "no-store" });
}
