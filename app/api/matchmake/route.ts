import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

function overlap(a: string[], b: string[]) {
  return a.filter((item) => b.includes(item));
}

type QueueUserData = {
  userId: string;
  username: string;
  rating: string;
  topicIds: string;
  joinedAt: string;
};

export async function POST() {
  try {
    const userIds = await redis.zrange("queue:global", 0, -1);

    for (const userId of userIds) {
      const rawA = (await redis.hgetall(
        `queue:user:${userId}`
      )) as QueueUserData | null;

      if (!rawA || !rawA.userId) continue;

      const ratingA = Number(rawA.rating);
      const topicsA: string[] = JSON.parse(rawA.topicIds || "[]");

      for (const otherUserId of userIds) {
        if (userId === otherUserId) continue;

        const rawB = (await redis.hgetall(
          `queue:user:${otherUserId}`
        )) as QueueUserData | null;

        if (!rawB || !rawB.userId) continue;

        const ratingB = Number(rawB.rating);
        const topicsB: string[] = JSON.parse(rawB.topicIds || "[]");

        const ratingDiff = Math.abs(ratingA - ratingB);
        const sharedTopics = overlap(topicsA, topicsB);

        if (ratingDiff <= 150 && sharedTopics.length > 0) {
          const topicId = sharedTopics[0];
          const matchId = `match_${Date.now()}`;
          const player1Side = Math.random() > 0.5 ? "PRO" : "CON";
          const player2Side = player1Side === "PRO" ? "CON" : "PRO";

          await redis.zrem("queue:global", userId);
          await redis.zrem("queue:global", otherUserId);
          await redis.del(`queue:user:${userId}`);
          await redis.del(`queue:user:${otherUserId}`);

          await redis.hset(`match:${matchId}`, {
            matchId,
            player1Id: userId,
            player2Id: otherUserId,
            player1Username: rawA.username,
            player2Username: rawB.username,
            topicId,
            player1Side,
            player2Side,
            status: "live",
            createdAt: String(Date.now()),
          });

          await redis.set(`match:user:${userId}`, matchId);
          await redis.set(`match:user:${otherUserId}`, matchId);

          return NextResponse.json({
            ok: true,
            matchFound: true,
            matchId,
            player1Id: userId,
            player2Id: otherUserId,
            topicId,
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      matchFound: false,
    });
  } catch (error) {
    console.error("matchmake error", error);
    return NextResponse.json(
      { error: "Failed to run matchmaking" },
      { status: 500 }
    );
  }
}