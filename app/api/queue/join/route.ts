import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { normalizeTopics, topicsKey } from "@/lib/topics";

type QueueUser = {
  userId: string;
  username: string;
  topics: string[];
  joinedAt: number;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const userId = String(body.userId || "").trim();
    const username = String(body.username || "").trim();
    const topics = normalizeTopics(body.topics || []);

    if (!userId || !username || topics.length === 0) {
      return NextResponse.json(
        { error: "Missing userId, username, or topics" },
        { status: 400 }
      );
    }

    const existingMatchId = await redis.get<string>(`user:${userId}:match`);
    if (existingMatchId) {
      return NextResponse.json({
        matched: true,
        matchId: existingMatchId,
      });
    }

    const key = topicsKey(topics);
    const queueKey = `queue:topics:${key}`;

    const me: QueueUser = {
      userId,
      username,
      topics,
      joinedAt: Date.now(),
    };

    const rawQueuedUsers = await redis.lrange<string[]>(queueKey, 0, -1);
    const queuedUsers: QueueUser[] = (rawQueuedUsers || []).map((item) =>
      typeof item === "string" ? JSON.parse(item) : item
    );

    const opponent = queuedUsers.find((u) => u.userId !== userId);

    if (opponent) {
      await redis.lrem(queueKey, 1, JSON.stringify(opponent));

      const matchId = crypto.randomUUID();
      const now = Date.now();

      const match = {
        id: matchId,
        topics,
        createdAt: now,
        status: "active",
        player1: {
          userId: opponent.userId,
          username: opponent.username,
        },
        player2: {
          userId,
          username,
        },
      };

      await redis.set(`match:${matchId}`, match);
      await redis.set(`user:${opponent.userId}:match`, matchId);
      await redis.set(`user:${userId}:match`, matchId);

      await redis.del(`user:${opponent.userId}:queue`);
      await redis.del(`user:${userId}:queue`);

      return NextResponse.json({
        matched: true,
        matchId,
      });
    }

    const alreadyQueued = queuedUsers.some((u) => u.userId === userId);

    if (!alreadyQueued) {
      await redis.rpush(queueKey, JSON.stringify(me));
    }

    await redis.set(`user:${userId}:queue`, key);

    return NextResponse.json({
      matched: false,
      queued: true,
      topicKey: key,
    });
  } catch (error) {
    console.error("queue/join error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}