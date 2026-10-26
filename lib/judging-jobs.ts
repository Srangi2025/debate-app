export const JUDGING_QUEUE = "judging:jobs";
export const JUDGING_JOB_PREFIX = "judging:job:";
export const JUDGING_HEARTBEAT = "judging:worker-heartbeat";
export const JOB_LEASE_MS = 240_000;
export const MAX_JUDGING_ATTEMPTS = 5;

// Only the current owner can keep a long inference alive. A dead process stops
// renewing; its scheduled lease still becomes reclaimable by another worker.
export const RENEW_JUDGING_SCRIPT = `
local raw = redis.call('GET', KEYS[2])
if not raw or redis.call('GET', KEYS[3]) ~= ARGV[2] then return 0 end
local job = cjson.decode(raw)
if job.token ~= ARGV[2] or job.status ~= 'judging' then return 0 end
job.updatedAt = tonumber(ARGV[3])
job.nextAttemptAt = tonumber(ARGV[3]) + tonumber(ARGV[4])
redis.call('PEXPIRE', KEYS[3], ARGV[4])
redis.call('SET', KEYS[2], cjson.encode(job))
redis.call('ZADD', KEYS[1], job.nextAttemptAt, ARGV[1])
return 1
`;

export type JudgingJob = {
  matchId: string;
  status: "queued" | "judging" | "retrying" | "failed" | "completed";
  attempts: number;
  queuedAt: number;
  updatedAt: number;
  nextAttemptAt?: number;
  completedAt?: number;
  error?: string;
  token?: string;
};

// Retrying from two browsers cannot reset an active lease or retry backoff.
export const ENQUEUE_JUDGING_SCRIPT = `
local rawMatch = redis.call('GET', KEYS[3])
if not rawMatch then return cjson.encode({error = 'Match not found', statusCode = 404}) end
local match = cjson.decode(rawMatch)
if match.status == 'ended' then return cjson.encode({status = 'completed'}) end
if match.status ~= 'pending_judgment' and match.status ~= 'judging' then
  return cjson.encode({error = 'Match is not ready for judging', statusCode = 409})
end
local raw = redis.call('GET', KEYS[2])
local job = raw and cjson.decode(raw) or nil
if job and job.status ~= 'failed' and job.status ~= 'completed' then
  return cjson.encode(job)
end
local now = tonumber(ARGV[2])
job = {matchId = ARGV[1], status = 'queued', attempts = 0, queuedAt = now, updatedAt = now, nextAttemptAt = now}
redis.call('SET', KEYS[2], cjson.encode(job))
redis.call('ZADD', KEYS[1], now, ARGV[1])
return cjson.encode(job)
`;

// The job stays in the schedule while leased. A crashed worker's lease expires
// and another worker can reclaim the same saved job without a browser request.
export const CLAIM_JUDGING_SCRIPT = `
local now = tonumber(ARGV[1])
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now, 'LIMIT', 0, 1)
if #ids == 0 then return nil end
local id = ids[1]
local key = ARGV[4] .. id
local raw = redis.call('GET', key)
if not raw then redis.call('ZREM', KEYS[1], id); return nil end
local job = cjson.decode(raw)
if job.status == 'completed' or job.status == 'failed' then
  redis.call('ZREM', KEYS[1], id); return nil
end
if job.attempts >= tonumber(ARGV[5]) then
  job.status = 'failed'
  job.error = 'Judging could not finish after several attempts. Please retry.'
  job.token = nil
  job.nextAttemptAt = nil
  job.updatedAt = now
  redis.call('SET', key, cjson.encode(job))
  redis.call('ZREM', KEYS[1], id)
  return nil
end
local lock = 'match:' .. id .. ':judging-lock'
if not redis.call('SET', lock, ARGV[2], 'PX', ARGV[3], 'NX') then
  redis.call('ZADD', KEYS[1], now + 1000, id)
  return nil
end
job.status = 'judging'
job.attempts = job.attempts + 1
job.token = ARGV[2]
job.updatedAt = now
job.nextAttemptAt = now + tonumber(ARGV[3])
job.error = nil
redis.call('SET', key, cjson.encode(job))
redis.call('ZADD', KEYS[1], job.nextAttemptAt, id)
return cjson.encode(job)
`;

export const SETTLE_JUDGING_SCRIPT = `
local raw = redis.call('GET', KEYS[2])
if not raw then return 0 end
local job = cjson.decode(raw)
if job.token ~= ARGV[2] then return 0 end
local now = tonumber(ARGV[3])
job.updatedAt = now
job.token = nil
if ARGV[4] == 'completed' then
  job.status = 'completed'
  job.completedAt = now
  job.nextAttemptAt = nil
  job.error = nil
  redis.call('ZREM', KEYS[1], ARGV[1])
elseif job.attempts >= tonumber(ARGV[5]) then
  job.status = 'failed'
  job.error = 'Judging could not finish after several attempts. Please retry.'
  job.nextAttemptAt = nil
  redis.call('ZREM', KEYS[1], ARGV[1])
else
  job.status = 'retrying'
  job.error = 'The AI judge is temporarily unavailable. Your debate is saved and will retry automatically.'
  job.nextAttemptAt = now + math.min(60000, 5000 * (2 ^ (job.attempts - 1)))
  redis.call('ZADD', KEYS[1], job.nextAttemptAt, ARGV[1])
end
redis.call('SET', KEYS[2], cjson.encode(job))
if redis.call('GET', KEYS[3]) == ARGV[2] then redis.call('DEL', KEYS[3]) end
return 1
`;
