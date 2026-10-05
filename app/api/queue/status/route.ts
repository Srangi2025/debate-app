import { authenticate } from "@/lib/server-auth";
import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { QUEUE_SCRIPT, type QueueResponse } from "@/lib/matchmaking";
import { normalizeTopics, TOPICS } from "@/lib/topics";

export async function GET(req: Request) {
  try {
    const auth = await authenticate(req);
    if (auth.response) return auth.response;
    const result = await redis.eval(QUEUE_SCRIPT, [], [
      auth.userId!, Date.now(), "status", "", "[]", crypto.randomUUID(), "",
    ]) as QueueResponse;
    return NextResponse.json(result);
  } catch (error) {
    console.error("queue/status error", error);
    return NextResponse.json({ error: "Unable to status queue" }, { status: 500 });
  }
}
