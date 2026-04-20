import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

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

    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    const topicKey = await redis.get<string>(`user:${userId}:queue`);
    if (!topicKey) {
      return NextResponse.json({ ok: true });
    }

    const queueKey = `queue:topics:${topicKey}`;
    const rawQueuedUsers = await redis.lrange<string[]>(queueKey, 0, -1);
    const queuedUsers: QueueUser[] = (rawQueuedUsers || []).map((item) =>
      typeof item === "string" ? JSON.parse(item) : item
    );

    const userToRemove = queuedUsers.find((u) => u.userId === userId);

    if (userToRemove) {
      await redis.lrem(queueKey, 1, JSON.stringify(userToRemove));
    }

    await redis.del(`user:${userId}:queue`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("queue/leave error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}