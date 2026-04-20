import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const matchId = String(body.matchId || "").trim();
    const senderUserId = String(body.senderUserId || "").trim();
    const answer = body.answer;

    if (!matchId || !senderUserId || !answer) {
      return NextResponse.json(
        { error: "Missing matchId, senderUserId, or answer" },
        { status: 400 }
      );
    }

    await redis.set(`signal:${matchId}:answer:${senderUserId}`, answer);
    await redis.expire(`signal:${matchId}:answer:${senderUserId}`, 300);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("webrtc/answer error", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}