import { authenticate } from "@/lib/server-auth";
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (auth.response) return auth.response;
    const userId = auth.userId;


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