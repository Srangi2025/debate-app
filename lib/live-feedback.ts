export const LIVE_FEEDBACK_QUEUE = "feedback:jobs";
export const LIVE_INTERVAL_MS = 25_000;
export const LIVE_LEASE_MS = 90_000;

export type FactClaim = {
  id: string; segmentId: string; userId: string; side: "A" | "B";
  quote: string; statement: string; kind: "fact" | "opinion" | "prediction";
  verdict: "supported" | "contradicted" | "mixed" | "unverified" | "not_checkable";
  reason: string; checkedAt: string;
  evidence: { title: string; url: string; provider: string; quote: string; retrievedAt: string }[];
};
export type LiveSnapshot = {
  summary: string;
  feedback: Record<"A" | "B", Record<"reasoning" | "evidence" | "rebuttals" | "relevance", string>>;
  claims: FactClaim[];
  rebuttals: { fromSegmentId: string; targetSegmentId: string; fromSide: "A" | "B"; targetSide: "A" | "B"; explanation: string }[];
  version: string; provider: string; model: string;
  revision: number; updatedAt: number;
};
export type LiveState = {
  status: "queued" | "analyzing" | "ready" | "retrying" | "closed";
  requestedRevision: number; analyzedRevision: number; updatedAt: number;
  lastAnalyzedAt?: number; attempts?: number; error?: string; token?: string;
};

// Included in the transcript append transaction; new text coalesces into the
// existing job instead of starting an inference for every audio clip or poll.
export const SCHEDULE_LIVE_LUA = `
local revision = redis.call('LLEN', KEYS[3])
local rawState = redis.call('GET', KEYS[7])
local state = rawState and cjson.decode(rawState) or {status = 'queued', analyzedRevision = 0, attempts = 0}
state.requestedRevision = revision
state.updatedAt = tonumber(ARGV[5])
if state.status ~= 'analyzing' then
  state.status = 'queued'
  if not redis.call('ZSCORE', KEYS[6], match.id) then
    local due = tonumber(ARGV[5]) + 4000
    if state.lastAnalyzedAt then due = math.max(due, state.lastAnalyzedAt + 25000) end
    redis.call('ZADD', KEYS[6], due, match.id)
  end
end
redis.call('SET', KEYS[7], cjson.encode(state))
`;

export const CLAIM_LIVE_SCRIPT = `
local now = tonumber(ARGV[1])
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now, 'LIMIT', 0, 1)
if #ids == 0 then return nil end
local id = ids[1]
local matchKey = 'match:' .. id
local rawMatch = redis.call('GET', matchKey)
local match = rawMatch and cjson.decode(rawMatch) or nil
local stateKey = matchKey .. ':feedback-state'
local rawState = redis.call('GET', stateKey)
local state = rawState and cjson.decode(rawState) or {analyzedRevision = 0, attempts = 0}
if not match or match.status ~= 'active' then
  state.status = 'closed'; state.token = nil; state.updatedAt = now
  redis.call('SET', stateKey, cjson.encode(state)); redis.call('ZREM', KEYS[1], id)
  return nil
end
local revision = redis.call('LLEN', matchKey .. ':transcript')
if revision <= (state.analyzedRevision or 0) then
  redis.call('ZREM', KEYS[1], id); return nil
end
if not redis.call('SET', matchKey .. ':feedback-lock', ARGV[2], 'PX', ARGV[3], 'NX') then
  redis.call('ZADD', KEYS[1], now + 1000, id); return nil
end
state.status = 'analyzing'; state.token = ARGV[2]; state.updatedAt = now
state.requestedRevision = revision; state.attempts = (state.attempts or 0) + 1; state.error = nil
redis.call('SET', stateKey, cjson.encode(state))
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[3]), id)
return cjson.encode({matchId = id, revision = revision})
`;

export const PUBLISH_LIVE_SCRIPT = `
local raw = redis.call('GET', KEYS[2])
if not raw then return 0 end
local state = cjson.decode(raw)
if state.token ~= ARGV[2] or redis.call('GET', KEYS[4]) ~= ARGV[2] then return 0 end
local now = tonumber(ARGV[3])
local rawMatch = redis.call('GET', KEYS[5])
local match = rawMatch and cjson.decode(rawMatch) or nil
state.token = nil; state.updatedAt = now
if not match or match.status ~= 'active' then
  state.status = 'closed'; redis.call('ZREM', KEYS[1], ARGV[1])
elseif ARGV[4] == '' then
  state.status = 'retrying'; state.error = 'Live feedback is temporarily unavailable. Your transcript is still being saved.'
  redis.call('ZADD', KEYS[1], now + 30000, ARGV[1])
else
  local snapshot = cjson.decode(ARGV[4])
  if snapshot.revision >= (state.analyzedRevision or 0) then
    redis.call('SET', KEYS[3], ARGV[4])
    state.analyzedRevision = snapshot.revision; state.lastAnalyzedAt = now
  end
  state.error = nil; state.attempts = 0
  local revision = redis.call('LLEN', KEYS[6])
  state.requestedRevision = revision
  if revision > state.analyzedRevision then
    state.status = 'queued'; redis.call('ZADD', KEYS[1], now + 25000, ARGV[1])
  else state.status = 'ready'; redis.call('ZREM', KEYS[1], ARGV[1]) end
end
redis.call('SET', KEYS[2], cjson.encode(state)); redis.call('DEL', KEYS[4])
return 1
`;

export function validLiveSnapshot(value: unknown): value is LiveSnapshot {
  if (!value || typeof value !== "object") return false;
  const data = value as LiveSnapshot;
  if (typeof data.summary !== "string" || !data.feedback || !Array.isArray(data.claims) || !Array.isArray(data.rebuttals) || typeof data.version !== "string") return false;
  for (const side of ["A", "B"] as const) for (const key of ["reasoning", "evidence", "rebuttals", "relevance"] as const) {
    if (typeof data.feedback[side]?.[key] !== "string") return false;
  }
  return data.claims.length <= 24 && data.claims.every(claim => {
    if (!claim || typeof claim.id !== "string" || typeof claim.segmentId !== "string" || typeof claim.userId !== "string" ||
        typeof claim.statement !== "string" || typeof claim.quote !== "string" || !claim.quote ||
        !["A", "B"].includes(claim.side) || !["fact", "opinion", "prediction"].includes(claim.kind) ||
        !["supported", "contradicted", "mixed", "unverified", "not_checkable"].includes(claim.verdict) ||
        typeof claim.reason !== "string" || !Array.isArray(claim.evidence)) return false;
    if ((claim.kind === "fact") === (claim.verdict === "not_checkable")) return false;
    if (["supported", "contradicted", "mixed"].includes(claim.verdict) && !claim.evidence.length) return false;
    return claim.evidence.every(source => {
      try {
        const url = new URL(source.url);
        return url.protocol === "https:" && url.hostname === "en.wikipedia.org" && url.pathname.startsWith("/wiki/") &&
          !url.username && !url.password && typeof source.title === "string" && typeof source.quote === "string" && !!source.quote && typeof source.retrievedAt === "string";
      } catch { return false; }
    });
  }) && data.rebuttals.every(item => item && typeof item.fromSegmentId === "string" && typeof item.targetSegmentId === "string" &&
    ["A", "B"].includes(item.fromSide) && ["A", "B"].includes(item.targetSide) && item.fromSide !== item.targetSide && typeof item.explanation === "string");
}
