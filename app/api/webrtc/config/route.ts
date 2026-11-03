import { NextRequest, NextResponse } from "next/server";
import { authenticate, authorizeMatch } from "@/lib/server-auth";
import { iceConfiguration } from "@/lib/ice-config";

export async function GET(req: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const auth = await authenticate(req);
    if (auth.response) return auth.response;
    const matchId = req.nextUrl.searchParams.get("matchId")?.trim();
    if (!matchId) return NextResponse.json({ error: "Missing matchId" }, { status: 400, headers });
    const access = await authorizeMatch(matchId, auth.userId);
    if (access.response) return access.response;
    if (access.match.status !== "active") {
      return NextResponse.json({ error: "This room is no longer active" }, { status: 409, headers });
    }
    return NextResponse.json(iceConfiguration(), { headers });
  } catch {
    return NextResponse.json({ error: "Call configuration unavailable. Please try again shortly." }, { status: 503, headers });
  }
}
