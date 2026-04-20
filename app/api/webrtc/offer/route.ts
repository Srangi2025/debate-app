import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const matchId = String(body.matchId || "").trim();
    const senderUserId = String(body.senderUserId || "").trim();
    const offer = body.offer;

    if (!matchId || !senderUserId || !offer) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    await redis.set(`signal:${matchId}:offer:${senderUserId}`, offer);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("webrtc/offer error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}