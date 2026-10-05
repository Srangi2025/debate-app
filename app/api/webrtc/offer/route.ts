import { authenticate, authorizeMatch } from "@/lib/server-auth";
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (auth.response) return auth.response;
    const userId = auth.userId;

    const body = await req.json();

    const matchId = String(body.matchId || "").trim();
    const senderUserId = userId;
    const offer = body.offer;

    if (!matchId || !senderUserId || !offer) {
      return NextResponse.json(
        { error: "Missing matchId, senderUserId, or offer" },
        { status: 400 }
      );
    }

    const access = await authorizeMatch(matchId, userId);
    if (access.response) return access.response;

    await redis.set(`signal:${matchId}:offer:${senderUserId}`, offer);
    await redis.expire(`signal:${matchId}:offer:${senderUserId}`, 300);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("webrtc/offer error", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}