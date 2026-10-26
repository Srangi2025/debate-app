import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";
import { redis } from "@/lib/redis";

export async function GET(req: Request) {
  try {
    const auth = await authenticate(req);
    if (auth.response) return auth.response;
    const username = await redis.hget<unknown>("users:usernames", auth.userId);
    return NextResponse.json({ username: username == null ? null : String(username) });
  } catch (error) {
    console.error("profile read error", error);
    return NextResponse.json({ error: "Unable to load your saved name. Please reload." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await authenticate(req);
    if (auth.response) return auth.response;
    const body: unknown = await req.json().catch(() => null);
    const username = body && typeof body === "object" && "username" in body && typeof body.username === "string"
      ? body.username.trim() : "";
    if (!username || username.length > 100) {
      return NextResponse.json({ error: "Enter a name between 1 and 100 characters." }, { status: 400 });
    }
    // The Redis SDK JSON-decodes reads. Encode names as JSON strings so values
    // such as "123", "true", or quoted text remain exactly the name entered.
    await redis.hset("users:usernames", { [auth.userId]: JSON.stringify(username) });
    return NextResponse.json({ username });
  } catch (error) {
    console.error("profile save error", error);
    return NextResponse.json({ error: "Your name could not be saved. Please try again." }, { status: 500 });
  }
}
