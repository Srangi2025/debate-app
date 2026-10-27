import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";
import { redis } from "@/lib/redis";
import { historyStore } from "@/lib/history-store";

export async function GET(req: Request) {
  try {
    const auth = await authenticate(req);
    if (auth.response) return auth.response;
    let username = historyStore().profile(auth.userId);
    if (username === null) {
      const legacy = await redis.hget<unknown>("users:usernames", auth.userId).catch(() => null);
      if (legacy != null) { username = String(legacy); historyStore().saveProfile(auth.userId, username); }
    }
    return NextResponse.json({ username, userId: auth.userId, kind: auth.kind, email: auth.email });
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
    historyStore().saveProfile(auth.userId, username);
    await redis.hset("users:usernames", { [auth.userId]: JSON.stringify(username) }).catch(() => {});
    return NextResponse.json({ username });
  } catch (error) {
    console.error("profile save error", error);
    return NextResponse.json({ error: "Your name could not be saved. Please try again." }, { status: 500 });
  }
}
