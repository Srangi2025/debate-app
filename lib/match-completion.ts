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
if match.status ~= 'active' then
  return cjson.encode({ error = 'This match is not active', statusCode = 409 })
end

redis.call('HSETNX', KEYS[2], userId, ARGV[2])
-- Keep the first response while the match is active, even if the opponent waits.
redis.call('PERSIST', KEYS[2])
local rawPlayer1 = redis.call('HGET', KEYS[2], match.player1.userId)
local rawPlayer2 = redis.call('HGET', KEYS[2], match.player2.userId)
if not rawPlayer1 or not rawPlayer2 then
  return cjson.encode({ ok = true, status = 'waiting' })
end
local player1 = cjson.decode(rawPlayer1)
local player2 = cjson.decode(rawPlayer2)

-- Count JavaScript string units for older submissions without a stored length.
local function textLength(text)
  local length = 0
  for index = 1, #text do
    local byte = string.byte(text, index)
    if byte < 128 or byte >= 192 then
      length = length + (byte >= 240 and 2 or 1)
    end
  end
  return length
end
local length1 = player1.transcriptLength or textLength(player1.transcript)
local length2 = player2.transcriptLength or textLength(player2.transcript)
local winner = match.player1
local loser = match.player2
if length2 > length1 then
  winner = match.player2
  loser = match.player1
end
local reason = 'Temporary scoring selected the longer submitted response. Argument quality was not evaluated.'
if length1 == length2 then
  reason = 'The responses have equal length. Temporary scoring awards ties to Player 1. Argument quality was not evaluated.'
end
local endedAt = tonumber(ARGV[3])
local result = {
  matchId = match.id,
  topics = match.topics,
  endedAt = endedAt,
  winner = winner,
  loser = loser,
  player1 = match.player1,
  player2 = match.player2,
  status = 'finished',
  judgeMethod = 'response-length',
  judgeReason = reason
}
redis.call('SET', KEYS[3], cjson.encode(result))
match.status = 'ended'
match.endedAt = endedAt
redis.call('SET', KEYS[1], cjson.encode(match))
redis.call('EXPIRE', KEYS[2], 3600)
-- A retry for an old match must never clear a player's newer active match.
for index = 4, 5 do
  if redis.call('GET', KEYS[index]) == match.id then
    redis.call('DEL', KEYS[index])
  end
end
return cjson.encode({ ok = true, status = 'completed', resultUrl = ARGV[4] })
`;

export type CompletionResponse = {
  ok?: boolean;
  status?: "waiting" | "completed";
  alreadyCompleted?: boolean;
  resultUrl?: string;
  error?: string;
  statusCode?: number;
};
