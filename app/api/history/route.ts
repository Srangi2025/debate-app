import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";
import { historyStore, type HistoryCursor } from "@/lib/history-store";

export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    const auth = await authenticate(req);
    if (auth.response) return auth.response;
    const value = new URL(req.url).searchParams.get("cursor");
    let cursor: HistoryCursor | undefined;
    if (value) {
      try {
        if (value.length > 512) throw new Error();
        const parsed = JSON.parse(Buffer.from(value, "base64url").toString());
        if (!Number.isSafeInteger(parsed.endedAt) || typeof parsed.id !== "string" || !parsed.id || parsed.id.length > 200) throw new Error();
        cursor = parsed;
      } catch { return NextResponse.json({ error: "Invalid history cursor" }, { status: 400 }); }
    }
    const page = historyStore().list(auth.userId, cursor);
    return NextResponse.json({ ...page, nextCursor: page.nextCursor ? Buffer.from(JSON.stringify(page.nextCursor)).toString("base64url") : null });
  } catch {
    return NextResponse.json({ error: "History is temporarily unavailable. Please retry." }, { status: 503 });
  }
}
