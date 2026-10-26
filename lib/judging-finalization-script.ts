export const FINALIZE_JUDGMENT_SCRIPT = `
local lockToken = redis.call('GET', KEYS[3])

if lockToken ~= ARGV[1] then
  return cjson.encode({
    ok = false,
    reason = 'lock_not_owned'
  })
end

local rawMatch = redis.call('GET', KEYS[1])
local rawResult = redis.call('GET', KEYS[2])

if not rawMatch or not rawResult then
  return cjson.encode({
    ok = false,
    reason = 'missing_match_or_result'
  })
end

local match = cjson.decode(rawMatch)
local result = cjson.decode(rawResult)

if match.status == 'ended' or result.status == 'finished' then
  return cjson.encode({
    ok = false,
    reason = 'already_finalized'
  })
end

if match.status ~= 'pending_judgment'
   and match.status ~= 'judging' then
  return cjson.encode({
    ok = false,
    reason = 'invalid_match_status'
  })
end

local judgment = cjson.decode(ARGV[2])

if judgment.winner ~= 'A'
   and judgment.winner ~= 'B'
   and judgment.winner ~= 'tie' then
  return cjson.encode({
    ok = false,
    reason = 'invalid_winner'
  })
end

result.judgeMethod = 'qwen-ai'
result.judgeReason = judgment.reasoning
result.judgeVersion = judgment.judge_version
result.rubricVersion = judgment.rubric_version
result.scores = judgment.scores
result.weightedScores = judgment.weighted_scores
result.strengths = judgment.strengths
result.improvements = judgment.improvements

if judgment.winner == 'A' then
  result.winner = match.player1
  result.loser = match.player2
elseif judgment.winner == 'B' then
  result.winner = match.player2
  result.loser = match.player1
else
  result.winner = cjson.null
  result.loser = cjson.null
end

result.status = 'finished'
match.status = 'ended'
match.endedAt = tonumber(ARGV[3])

redis.call('SET', KEYS[2], cjson.encode(result))
redis.call('SET', KEYS[1], cjson.encode(match))
redis.call('DEL', KEYS[3])

return cjson.encode({
  ok = true,
  status = 'finished'
})
`;

