import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { redis } from "@/lib/redis";
import { historyStore } from "./history-store";
import { resolveGuestCredential } from "./guest-sessions";

export async function currentGuest(credential: string | undefined): Promise<string | null> {
  return resolveGuestCredential(credential, historyStore(), redis);
}

export async function authenticate(req: Request) {
  const token = req.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) {
    const store = await cookies();
    const credential = store.get("debate-guest")?.value;
    const existing = await currentGuest(credential);
    if (existing) return { userId: existing, kind: "guest" as const, email: null };
    const sessionId = randomUUID();
    const userId = `guest:${randomUUID()}`;
    historyStore().rememberGuest(sessionId, userId, Date.now() + 30 * 86400000);
    await redis.set(`guest-session:${sessionId}`, userId, { ex: 60 * 60 * 24 * 30 }).catch(() => {});
    store.set("debate-guest", sessionId, {
      httpOnly: true, sameSite: "lax", secure: new URL(req.url).protocol === "https:",
      path: "/", maxAge: 60 * 60 * 24 * 30,
    });
    return { userId, kind: "guest" as const, email: null };
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { response: NextResponse.json({ error: "Authentication is not configured" }, { status: 503 }) };
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  // Verify with Supabase; never trust a browser-supplied ID or decoded JWT alone.
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { response: NextResponse.json({ error: "Invalid or expired account session" }, { status: 401 }) };
  return { userId: data.user.id, kind: data.user.is_anonymous ? "guest" as const : "account" as const, email: data.user.email ?? null };
}

export type MatchRecord = {
  id: string;
  topics: string[];
  createdAt: number;
  status: string;
  player1: { userId: string; username: string } | null;
  player2: { userId: string; username: string } | null;
};

export async function authorizeMatch(matchId: string, userId: string) {
  const match = await redis.get<MatchRecord>(`match:${matchId}`);
  if (!match) return { response: NextResponse.json({ error: "Match not found" }, { status: 404 }) };
  const participant = [match.player1, match.player2].find(player => player?.userId === userId ||
    (match.status !== "active" && player && historyStore().participantOwner(player.userId) === userId));
  if (!participant) {
    return { response: NextResponse.json({ error: "You are not a participant in this match" }, { status: 403 }) };
  }
  return { match, participantId: participant.userId };
}
