import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import IORedis from "ioredis";
import { Redis } from "@upstash/redis";
import { APPEND_TRANSCRIPT_SCRIPT } from "../lib/transcript.ts";
import { MATCH_COMPLETION_SCRIPT } from "../lib/match-completion.ts";
import { encodeWav } from "../lib/audio-wav.ts";

const tcp = new IORedis(process.env.REDIS_TEST_URL || "redis://127.0.0.1:6379", { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
tcp.on("error", () => {});
const redis = new Redis({ async request({ body: [command, ...args] }) { return { result: await tcp.call(command, ...args) }; } });
before(() => tcp.connect()); after(() => tcp.quit());

async function fixture(t) {
  const id = `test-transcript-${randomUUID()}`;
  const keys = [`match:${id}`, `match:${id}:submissions`, `match:${id}:transcript`, `match:${id}:transcript-ids`, `match:${id}:transcript-lengths`, `${id}:live-queue`, `match:${id}:feedback-state`];
  const completion = [keys[0], keys[1], `result:${id}`, `${id}:user-a:match`, `${id}:user-b:match`, `${id}:jobs`, `${id}:job`, keys[2]];
  t.after(() => redis.del(...new Set([...keys, ...completion])));
  await redis.set(keys[0], { id, status: "active", topics: ["ai-harm"], player1: { userId: "a", username: "First" }, player2: { userId: "b", username: "Second" } });
  return {
    id, keys, completion,
    append: (user, text, segment = randomUUID(), source = "speech") => redis.eval(APPEND_TRANSCRIPT_SCRIPT, keys, [user, segment, text, source, Date.now(), text.length]),
    submit: (user, text = "untrusted replacement") => redis.eval(MATCH_COMPLETION_SCRIPT, completion,
      [user, JSON.stringify({ userId: user, transcript: text }), Date.now(), `/result/${id}`, "captured"]),
  };
}

test("segments receive authenticated speakers and both transcripts remain separate", async (t) => {
  const f = await fixture(t);
  const first = await f.append("a", "A speaks");
  const second = await f.append("b", "B speaks", randomUUID(), "text");
  assert.equal(first.segment.username, "First"); assert.equal(first.segment.side, "A");
  assert.equal(second.segment.username, "Second"); assert.equal(second.segment.side, "B");
  assert.equal(second.segment.source, "text");
  assert.equal((await redis.lrange(f.keys[2], 0, -1)).length, 2);
  assert.equal((await f.append("intruder", "Spoofing")).statusCode, 403);
});

test("concurrent retries save one segment and acknowledgements survive closure", async (t) => {
  const f = await fixture(t); const segmentId = randomUUID();
  const replies = await Promise.all(Array.from({ length: 10 }, () => f.append("a", "Only once", segmentId)));
  assert.equal(await redis.llen(f.keys[2]), 1);
  assert.equal(replies.filter(reply => !reply.duplicate).length, 1);
  await f.submit("a");
  assert.equal((await f.append("a", "Only once", segmentId)).duplicate, true);
  assert.equal((await f.append("a", "Too late")).statusCode, 409);
});

test("submission freezes exactly the server-saved speaker text and queues judging", async (t) => {
  const f = await fixture(t);
  await f.append("a", "First argument"); await f.append("b", "Other argument"); await f.append("a", "Follow-up", randomUUID(), "text");
  assert.equal((await f.submit("a")).status, "waiting");
  assert.equal((await redis.hget(f.keys[1], "a")).transcript, "First argument\nFollow-up");
  assert.equal((await redis.hget(f.keys[1], "a")).source, "captured");
  assert.equal((await f.submit("b")).status, "pending_judgment");
  assert.equal((await redis.get(f.completion[6])).status, "queued");
  assert.equal((await redis.hget(f.keys[1], "b")).transcript, "Other argument");
  assert.equal((await f.append("b", "Late speech")).statusCode, 409);
});

test("empty captured submissions and over-limit segments cannot change saved evidence", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.submit("a")).statusCode, 400);
  await redis.hset(f.keys[4], { a: 19999 });
  assert.equal((await f.append("a", "Over the limit")).statusCode, 413);
  assert.equal(await redis.llen(f.keys[2]), 0);
});

test("audio encoding emits mono 16 kHz PCM and preserves duration and limits", () => {
  const input = new Float32Array(48000).fill(0.5);
  const wav = encodeWav(input, 48000); const view = new DataView(wav.buffer);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), "RIFF");
  assert.equal(view.getUint32(24, true), 16000); assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint16(34, true), 16); assert.equal(wav.length, 44 + 32000);
  assert.equal(view.getInt16(44, true), 16384);
});
