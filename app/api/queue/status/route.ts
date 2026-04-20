import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = String(searchParams.get("userId") || "").trim();

    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    const matchId = await redis.get<string>(`user:${userId}:match`);
    if (matchId) {
      return NextResponse.json({
        matched: true,
        matchId,
      });
    }

    const queueTopicKey = await redis.get<string>(`user:${userId}:queue`);

    return NextResponse.json({
      matched: false,
      queued: !!queueTopicKey,
    });
  } catch (error) {
    console.error("queue/status error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}