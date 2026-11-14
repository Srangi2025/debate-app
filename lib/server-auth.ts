import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { redis } from "@/lib/redis";
import { historyStore } from "./history-store";
import { resolveGuestCredential } from "./guest-sessions";
import { pilotAccess } from "./pilot-access";

export async function currentGuest(credential: string | undefined): Promise<string | null> {
  return resolveGuestCredential(credential, historyStore(), redis);
}

type Authentication =
  | { response: NextResponse; userId?: never; kind?: never; email?: never }
  | { response?: never; userId: string; kind: "guest" | "account"; email: string | null };

export async function authenticate(req: Request, options: { allowUninvited?: boolean } = {}): Promise<Authentication> {
  const denied = (identity: { userId: string; kind: "guest" | "account" } | null) => {
    const failure = options.allowUninvited ? null : pilotAccess(identity);
    return failure ? { response: NextResponse.json({ error: failure.error }, {
      status: failure.status, headers: { "Cache-Control": "private, no-store" },
    }) } : null;
  };
  const token = req.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) {
    const failure = denied(null);
    if (failure) return failure;
    const store = await cookies();
    const credential = store.get("debate-guest")?.value;
    const existing = await currentGuest(credential);
    if (existing) return { userId: existing, kind: "guest" as const, email: null };
    const sessionId = randomUUID();
    const userId = `guest:${randomUUID()}`;
    await historyStore().rememberGuest(sessionId, userId, Date.now() + 30 * 86400000);
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
  const identity = { userId: data.user.id, kind: data.user.is_anonymous ? "guest" as const : "account" as const, email: data.user.email ?? null };
  const failure = denied(identity);
  if (failure) return failure;
  return identity;
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
  let participant = [match.player1, match.player2].find(player => player?.userId === userId);
  if (!participant && match.status !== "active") {
    for (const player of [match.player1, match.player2]) {
      if (player && await historyStore().participantOwner(player.userId) === userId) { participant = player; break; }
    }
  }
  if (!participant) {
    return { response: NextResponse.json({ error: "You are not a participant in this match" }, { status: 403 }) };
  }
  return { match, participantId: participant.userId };
}
