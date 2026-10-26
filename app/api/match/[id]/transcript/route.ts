import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authenticate, authorizeMatch } from "@/lib/server-auth";
import { redis } from "@/lib/redis";
import { APPEND_TRANSCRIPT_SCRIPT, MAX_AUDIO_BYTES, MAX_SEGMENT_LENGTH, type TranscriptSegment } from "@/lib/transcript";
import { LIVE_FEEDBACK_QUEUE } from "@/lib/live-feedback";

export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: Context) {
  try {
    const auth = await authenticate(req);
    if (auth.response) return auth.response;
    const { id } = await context.params;
    const access = await authorizeMatch(id, auth.userId);
    if (access.response) return access.response;
    const segments = await redis.lrange<TranscriptSegment>(`match:${id}:transcript`, 0, -1);
    return NextResponse.json({ segments });
  } catch (error) {
    console.error("transcript read error", error);
    return NextResponse.json({ error: "Unable to load the transcript. Retrying..." }, { status: 503 });
  }
}

export async function POST(req: Request, context: Context) {
  let lockKey: string | undefined;
  let lockToken: string | undefined;
  try {
    const auth = await authenticate(req);
    if (auth.response) return auth.response;
    const { id } = await context.params;
    const access = await authorizeMatch(id, auth.userId);
    if (access.response) return access.response;
    if (Number(req.headers.get("content-length") ?? 0) > MAX_AUDIO_BYTES + 10000) {
      return NextResponse.json({ error: "Audio clip is too large. Keep clips under 15 seconds." }, { status: 413 });
    }
    const form = await req.formData().catch(() => null);
    const segmentId = form?.get("segmentId");
    const source = form?.get("source");
    if (typeof segmentId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(segmentId) || !["speech", "text"].includes(String(source))) {
      return NextResponse.json({ error: "Invalid transcript segment" }, { status: 400 });
    }
    const saved = await redis.hget<TranscriptSegment>(`match:${id}:transcript-ids`, `${auth.userId}:${segmentId}`);
    if (saved) return NextResponse.json({ segment: saved, duplicate: true });
    if (access.match.status !== "active" || await redis.hexists(`match:${id}:submissions`, auth.userId)) {
      return NextResponse.json({ error: "Your transcript is already closed for this debate" }, { status: 409 });
    }
    let text = "";
    if (source === "speech") {
      const audio = form?.get("audio");
      if (!(audio instanceof File) || !audio.size || audio.size > MAX_AUDIO_BYTES) {
        return NextResponse.json({ error: "Provide an audio clip under 1 MB" }, { status: 400 });
      }
      const service = process.env.TRANSCRIPTION_URL || process.env.AI_JUDGE_URL;
      if (!service) return NextResponse.json({ error: "Speech capture is unavailable. Your clip is saved locally for retry, or you can add text." }, { status: 503 });
      lockKey = `match:${id}:transcribing:${auth.userId}:${segmentId}`;
      lockToken = randomUUID();
      if (await redis.set(lockKey, lockToken, { nx: true, ex: 60 }) !== "OK") {
        lockKey = undefined;
        return NextResponse.json({ error: "This clip is still being transcribed. Retrying..." }, { status: 503 });
      }
      const payload = new FormData();
      payload.append("audio", audio, "speech.wav");
      const response = await fetch(`${service.replace(/\/+$/, "")}/transcribe`, {
        method: "POST", body: payload, signal: AbortSignal.timeout(45000), cache: "no-store",
      });
      if (response.status === 400 || response.status === 413) return NextResponse.json({ error: "This audio clip could not be read. Discard the unsaved clip and add your contribution as text." }, { status: 400 });
      if (!response.ok) return NextResponse.json({ error: "Speech capture is temporarily unavailable. Your clip is saved locally and will retry." }, { status: 503 });
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || !("text" in data) || typeof data.text !== "string") {
        throw new Error("Invalid transcription response");
      }
      text = data.text.trim();
      if (!text) return NextResponse.json({ skipped: true });
    } else {
      const value = form?.get("text");
      text = typeof value === "string" ? value.trim() : "";
    }
    if (!text || text.length > MAX_SEGMENT_LENGTH) {
      return NextResponse.json({ error: "Keep each contribution between 1 and 2,000 characters." }, { status: 400 });
    }
    const outcome = await redis.eval<unknown[], { segment?: TranscriptSegment; error?: string; statusCode?: number }>(
      APPEND_TRANSCRIPT_SCRIPT,
      [`match:${id}`, `match:${id}:submissions`, `match:${id}:transcript`, `match:${id}:transcript-ids`, `match:${id}:transcript-lengths`, LIVE_FEEDBACK_QUEUE, `match:${id}:feedback-state`],
      [auth.userId, segmentId, text, source, Date.now(), text.length]
    );
    return NextResponse.json(outcome, { status: outcome.statusCode ?? 200 });
  } catch (error) {
    console.error("transcript save error", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Unable to save this contribution. It will retry from this browser." }, { status: 503 });
  } finally {
    if (lockKey && lockToken) {
      await redis.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", [lockKey], [lockToken]).catch(() => {});
    }
  }
}
