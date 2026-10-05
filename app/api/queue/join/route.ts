import { authenticate } from "@/lib/server-auth";
import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { QUEUE_SCRIPT, type QueueResponse } from "@/lib/matchmaking";
import { normalizeTopics, TOPICS } from "@/lib/topics";

export async function POST(req: Request) {
  try {
    const auth = await authenticate(req);
    if (auth.response) return auth.response;
    const body = await req.json();
    if (typeof body.username !== "string" || !body.username.trim() ||
        !Array.isArray(body.topics) || body.topics.some((topic: unknown) => typeof topic !== "string")) {
      return NextResponse.json({ error: "Provide a username and topics" }, { status: 400 });
    }
    const topics = normalizeTopics(body.topics);
    if (!topics.length || topics.length > 5 || topics.some(topic => !TOPICS.some(known => known.id === topic))) {
      return NextResponse.json({ error: "Select between one and five valid topics" }, { status: 400 });
    }
    const result = await redis.eval(QUEUE_SCRIPT, [], [
      auth.userId!, Date.now(), "join", body.username.trim().slice(0, 100), JSON.stringify(topics), crypto.randomUUID(), "",
    ]) as QueueResponse;
    return NextResponse.json(result);
  } catch (error) {
    console.error("queue/join error", error);
    return NextResponse.json({ error: "Unable to join queue" }, { status: 500 });
  }
}
