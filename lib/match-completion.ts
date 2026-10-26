export const MAX_TRANSCRIPT_LENGTH = 20000;

// Redis runs this as one operation: retries cannot replace a submission or result,
// and two simultaneous submissions cannot finalize the match twice.
export const MATCH_COMPLETION_SCRIPT = `
local rawMatch = redis.call('GET', KEYS[1])
if not rawMatch then
  return cjson.encode({ error = 'Match not found', statusCode = 404 })
end
local match = cjson.decode(rawMatch)
if type(match.player1) ~= 'table' or type(match.player2) ~= 'table' then
  return cjson.encode({ error = 'Both players must join before submitting', statusCode = 409 })
end
local userId = ARGV[1]
if userId ~= match.player1.userId and userId ~= match.player2.userId then
  return cjson.encode({ error = 'You are not a participant in this match', statusCode = 403 })
end
if match.status == 'ended' then
  return cjson.encode({ ok = true, status = 'completed', alreadyCompleted = true, resultUrl = ARGV[4] })
end
if match.status == 'pending_judgment' or match.status == 'judging' then
  return cjson.encode({ ok = true, status = 'pending_judgment', alreadyCompleted = true, resultUrl = ARGV[4] })
end
if match.status ~= 'active' then
  return cjson.encode({ error = 'This match is not active', statusCode = 409 })
end

local submitted = ARGV[2]
if ARGV[5] == 'captured' then
  local lines = {}
  for _, encoded in ipairs(redis.call('LRANGE', KEYS[8], 0, -1)) do
    local segment = cjson.decode(encoded)
    if segment.userId == userId then table.insert(lines, segment.text) end
  end
  local text = table.concat(lines, '\\n')
  if text == '' then
    return cjson.encode({error = 'Save a spoken or typed contribution before submitting', statusCode = 400})
  end
  submitted = cjson.encode({userId = userId, transcript = text, submittedAt = tonumber(ARGV[3]), source = 'captured'})
end
redis.call('HSETNX', KEYS[2], userId, submitted)
-- Keep the first response while the match is active, even if the opponent waits.
redis.call('PERSIST', KEYS[2])
local rawPlayer1 = redis.call('HGET', KEYS[2], match.player1.userId)
local rawPlayer2 = redis.call('HGET', KEYS[2], match.player2.userId)
if not rawPlayer1 or not rawPlayer2 then
  return cjson.encode({ ok = true, status = 'waiting' })
end
local player1 = cjson.decode(rawPlayer1)
local player2 = cjson.decode(rawPlayer2)


-- Both players have submitted their arguments.
-- Store a pending result until the Python AI judge finishes.
local endedAt = tonumber(ARGV[3])

local result = {
  matchId = match.id,
  topics = match.topics,
  endedAt = endedAt,
  winner = cjson.null,
  loser = cjson.null,
  player1 = match.player1,
  player2 = match.player2,
  status = 'pending_judgment',
  judgeMethod = 'qwen-ai',
  judgeReason = 'Both submissions received. Waiting for AI evaluation.'
}
redis.call('SET', KEYS[3], cjson.encode(result))
-- Publish the job in the same transaction as the pending result. A server
-- shutdown after this point cannot leave an accepted debate without a job.
redis.call('SET', KEYS[7], cjson.encode({
  matchId = match.id, status = 'queued', attempts = 0,
  queuedAt = endedAt, updatedAt = endedAt, nextAttemptAt = endedAt
}))
redis.call('ZADD', KEYS[6], endedAt, match.id)
match.status = 'pending_judgment'
match.endedAt = endedAt
redis.call('SET', KEYS[1], cjson.encode(match))
-- Retain the evidence until the judgment has actually been saved. A judge
-- outage must not delete the submissions needed for a later retry.
redis.call('PERSIST', KEYS[2])
-- A retry for an old match must never clear a player's newer active match.
for index = 4, 5 do
  if redis.call('GET', KEYS[index]) == match.id then
    redis.call('DEL', KEYS[index])
  end
end
return cjson.encode({ ok = true, status = 'pending_judgment', resultUrl = ARGV[4] })
`;

export type CompletionResponse = {
  ok?: boolean;
  status?: "waiting" | "pending_judgment" | "completed";
  alreadyCompleted?: boolean;
  resultUrl?: string;
  error?: string;
  statusCode?: number;
};
