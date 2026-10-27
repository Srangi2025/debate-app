import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server-auth";
import { historyStore } from "@/lib/history-store";

export const runtime = "nodejs";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticate(req);
    if (auth.response) return auth.response;
    const { id } = await params;
    const archived = historyStore().get(auth.userId, id);
    if (!archived) return NextResponse.json({ error: "Saved debate not found" }, { status: 404 });
    return NextResponse.json(archived);
  } catch {
    return NextResponse.json({ error: "Unable to read the saved debate. Please retry." }, { status: 503 });
  }
}
