import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authenticate, currentGuest } from "@/lib/server-auth";
import { historyStore } from "@/lib/history-store";
import { redis } from "@/lib/redis";

export async function GET(req: Request) {
  try {
    const auth = await authenticate(req);
    if (auth.response) return auth.response;
    const credential = (await cookies()).get("debate-guest")?.value;
    const guest = await currentGuest(credential);
    async function activity(id: string) {
      const [queued, room] = await Promise.all([redis.get<{ lastSeenAt?: number; joinedAt?: number }>(`user:${id}:queue`), redis.get<string>(`user:${id}:match`)]);
      const match = room ? await redis.get<{ status: string }>(`match:${room}`) : null;
      return { queued: !!queued && (queued.lastSeenAt ?? queued.joinedAt ?? 0) > Date.now() - 120000, matchId: match?.status === "active" ? room : null };
    }
    const ownActivity = await activity(auth.userId);
    return NextResponse.json({ kind: auth.kind, email: auth.email, userId: auth.userId, activity: ownActivity,
      guest: guest && auth.kind === "account" ? {
        available: true, username: historyStore().profile(guest) ?? await redis.hget("users:usernames", guest),
        activity: await activity(guest),
      } : null });
  } catch {
    return NextResponse.json({ error: "Unable to check account status. Please retry." }, { status: 503 });
  }
}
