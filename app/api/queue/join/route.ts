import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

type JoinQueueBody = {
  userId: string;
  username: string;
  rating: number;
  topicIds: string[];
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as JoinQueueBody;
    const { userId, username, rating, topicIds } = body;

    if (
      !userId ||
      !username ||
      !Array.isArray(topicIds) ||
      topicIds.length === 0
    ) {
      return NextResponse.json(
        { error: "Missing userId, username, or topicIds" },
        { status: 400 }
      );
    }

    const joinedAt = Date.now();

    await redis.zadd("queue:global", { score: rating, member: userId });

    await redis.hset(`queue:user:${userId}`, {
      userId,
      username,
      rating: String(rating),
      topicIds: JSON.stringify(topicIds),
      joinedAt: String(joinedAt),
    });

    await redis.hset("users:ratings", {
      [userId]: String(rating),
    });

    await redis.hset("users:usernames", {
      [userId]: username,
    });

    return NextResponse.json({
      ok: true,
      queued: true,
      userId,
      username,
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