import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";

export async function POST(req: Request) {
  const auth = await authenticate(req);
  if (auth.response) return auth.response;
  return NextResponse.json({ user: { id: auth.userId } });
}
