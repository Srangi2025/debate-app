import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const matchId = String(searchParams.get("matchId") || "").trim();
    const otherUserId = String(searchParams.get("otherUserId") || "").trim();

    if (!matchId || !otherUserId) {
      return NextResponse.json(
        { error: "Missing matchId or otherUserId" },
        { status: 400 }
      );
    }

    const offer = await redis.get(`signal:${matchId}:offer:${otherUserId}`);
    const answer = await redis.get(`signal:${matchId}:answer:${otherUserId}`);

    const rawCandidates =
      (await redis.lrange(`signal:${matchId}:candidates:${otherUserId}`, 0, -1)) || [];

    const candidates = rawCandidates.map((item: any) => {
      try {
        return typeof item === "string" ? JSON.parse(item) : item;
      } catch {
        return null;
      }
    }).filter(Boolean);

    return NextResponse.json({
      offer: offer || null,
      answer: answer || null,
      candidates,
    });
  } catch (error) {
    console.error("webrtc/poll error", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}