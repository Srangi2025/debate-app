import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json({ error: "Missing match ID" }, { status: 400 });
    }

    const match = await redis.get(`match:${id}`);

    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    return NextResponse.json(match);
  } catch (error) {
    console.error("match/[id] error", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}