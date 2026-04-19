import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

type LeaveQueueBody = {
  userId: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as LeaveQueueBody;
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    await redis.zrem("queue:global", userId);
    await redis.del(`queue:user:${userId}`);

    return NextResponse.json({
      ok: true,
      removed: true,
      userId,
    });
  } catch (error) {
    console.error("queue/leave error", error);
    return NextResponse.json(
      { error: "Failed to leave queue" },
      { status: 500 }
    );
  }
}