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

    if (!matchId) {
      return NextResponse.json(
        { error: "Missing matchId" },
        { status: 400 }
      );
    }

    const access = await authorizeMatch(matchId, userId);
    if (access.response) return access.response;

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