import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const matchId = String(body.matchId || "").trim();

    if (!matchId) {
      return NextResponse.json(
        { error: "Missing matchId" },
        { status: 400 }
      );
    }

    const keys = await redis.keys(`signal:${matchId}:*`);

    if (keys.length > 0) {
      await redis.del(...keys);
    }

    return NextResponse.json({
      ok: true,
      deleted: keys.length,
    });
  } catch (error) {
    console.error("webrtc/reset error", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}