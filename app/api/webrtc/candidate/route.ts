import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const matchId = String(body.matchId || "").trim();
    const senderUserId = String(body.senderUserId || "").trim();
    const candidate = body.candidate;

    if (!matchId || !senderUserId || !candidate) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    await redis.rpush(
      `signal:${matchId}:candidates:${senderUserId}`,
      JSON.stringify(candidate)
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("webrtc/candidate error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}