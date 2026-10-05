import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ error: "Database reset is disabled" }, { status: 410 });
}
