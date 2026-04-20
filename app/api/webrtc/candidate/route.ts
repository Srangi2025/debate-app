import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const matchId = String(body.matchId || "").trim();
    const senderUserId = String(body.senderUserId || "").trim();
    const candidate = body.candidate;

    if (!matchId || !senderUserId || !candidate) {
      return NextResponse.json(
        { error: "Missing matchId, senderUserId, or candidate" },
        { status: 400 }
      );
    }

    const key = `signal:${matchId}:candidates:${senderUserId}`;

    await redis.rpush(key, JSON.stringify(candidate));
    await redis.expire(key, 300);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("webrtc/candidate error", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}