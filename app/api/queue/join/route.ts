import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

type JoinQueueBody = {
  userId: string;
  rating: number;
  topicIds: string[];
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as JoinQueueBody;
    const { userId, rating, topicIds } = body;

    if (!userId || !Array.isArray(topicIds) || topicIds.length === 0) {
      return NextResponse.json(
        { error: "Missing userId or topicIds" },
        { status: 400 }
      );
    }

    const joinedAt = Date.now();

    await redis.zadd("queue:global", rating, userId);
    await redis.hset(`queue:user:${userId}`, {
      userId,
      rating: String(rating),
      topicIds: JSON.stringify(topicIds),
      joinedAt: String(joinedAt),
    });

    return NextResponse.json({
      ok: true,
      queued: true,
      userId,
      rating,
      topicIds,
    });
  } catch (error) {
    console.error("queue/join error", error);
    return NextResponse.json(
      { error: "Failed to join queue" },
      { status: 500 }
    );
  }
}