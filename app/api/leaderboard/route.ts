import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function GET() {
  try {
    const ratings = await redis.hgetall("users:ratings");
    const usernames = await redis.hgetall("users:usernames");

    const players = Object.entries(ratings ?? {})
      .map(([userId, ratingValue]) => ({
        userId,
        username: (usernames?.[userId] as string) || userId,
        rating: Number(ratingValue),
      }))
      .sort((a, b) => b.rating - a.rating)
      .map((player, index) => ({
        rank: index + 1,
        ...player,
      }));

    return NextResponse.json({
      players,
    });
  } catch (error) {
    console.error("leaderboard error", error);
    return NextResponse.json(
      { error: "Failed to load leaderboard" },
      { status: 500 }
    );
  }
}