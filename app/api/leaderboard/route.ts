import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

type StringMap = Record<string, string>;

export async function GET() {
  try {
    const rawRatings = await redis.hgetall("users:ratings");
    const rawUsernames = await redis.hgetall("users:usernames");

    const ratings = (rawRatings ?? {}) as StringMap;
    const usernames = (rawUsernames ?? {}) as StringMap;

    const players = Object.entries(ratings)
      .map(([userId, ratingValue]) => ({
        userId,
        username: usernames[userId] || userId,
        rating: Number(ratingValue) || 1000,
      }))
      .sort((a, b) => b.rating - a.rating)
      .map((player, index) => ({
        rank: index + 1,
        ...player,
      }));

    return NextResponse.json({ players });
  } catch (error) {
    console.error("leaderboard error", error);
    return NextResponse.json(
      { error: "Failed to load leaderboard" },
      { status: 500 }
    );
  }
}