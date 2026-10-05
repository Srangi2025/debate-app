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

    const access = await authorizeMatch(id, userId);
    if (access.response) return access.response;

    const result = await redis.get(`result:${id}`);

    if (!result) {
      return NextResponse.json({ error: "Result not found" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("result/[id] error", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}