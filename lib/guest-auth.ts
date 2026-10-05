"use client";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;
let pendingSession: Promise<Session> | undefined;

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Guest sign-in is not configured. Add the Supabase environment variables.");
  return (client ??= createClient(url, key));
}

export function getGuestSession(): Promise<Session> {
  // Share initialization across components, including React's development effect replay.
  if (!pendingSession) {
    pendingSession = (async () => {
      const supabase = getClient();
      const { data, error } = await supabase.auth.getSession();
      if (error) throw new Error("Unable to restore your guest session. Please reload.");
      if (data.session) return data.session;
      const signedIn = await supabase.auth.signInAnonymously();
      if (signedIn.error || !signedIn.data.session) {
        throw new Error("Guest sign-in failed. Check your connection and that anonymous sign-ins are enabled in Supabase.");
      }
      return signedIn.data.session;
    })().finally(() => { pendingSession = undefined; });
  }
  return pendingSession;
}

export async function authenticatedFetch(url: string, init: RequestInit = {}) {
  const session = await getGuestSession();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  return fetch(url, { ...init, headers, cache: "no-store" });
}
