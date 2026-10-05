import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ error: "Use the authenticated queue endpoints" }, { status: 410 });
}
