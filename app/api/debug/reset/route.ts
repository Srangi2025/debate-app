import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function POST() {
  try {
    const keys = await redis.keys("*");

    if (keys.length > 0) {
      await redis.del(...keys);
    }

    return NextResponse.json({
      ok: true,
      deleted: keys.length,
      keys,
    });
  } catch (error) {
    console.error("debug/reset error", error);
    return NextResponse.json(
      { error: "Failed to reset Redis" },
      { status: 500 }
    );
  }
}