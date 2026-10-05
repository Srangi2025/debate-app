import { authenticate, authorizeMatch } from "@/lib/server-auth";
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticate(req);
    if (auth.response) return auth.response;
    const userId = auth.userId;

    const { id } = await context.params;

    if (!id) {
      return NextResponse.json({ error: "Missing match ID" }, { status: 400 });
    }

    const access = await authorizeMatch(id, userId);
    if (access.response) return access.response;
    const submission = await redis.hget<{ transcript: string }>(`match:${id}:submissions`, userId);
    return NextResponse.json({
      ...access.match,
      submissionReceived: !!submission,
      submittedTranscript: submission?.transcript,
    });
  } catch (error) {
    console.error("match/[id] error", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
