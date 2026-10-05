import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function authenticate(req: Request) {
  const token = req.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return { response: NextResponse.json({ error: "Guest sign-in required" }, { status: 401 }) };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { response: NextResponse.json({ error: "Authentication is not configured" }, { status: 503 }) };
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  // Verify with Supabase; never trust a browser-supplied ID or decoded JWT alone.
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { response: NextResponse.json({ error: "Invalid or expired guest session" }, { status: 401 }) };
  return { userId: data.user.id };
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
  if (match.player1?.userId !== userId && match.player2?.userId !== userId) {
    return { response: NextResponse.json({ error: "You are not a participant in this match" }, { status: 403 }) };
  }
  return { match };
}
