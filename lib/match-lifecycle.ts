// Update room presence and release both players atomically. A delayed request
// for an old room must never remove a player's pointer to a newer room.
export const MATCH_LIFECYCLE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({error = 'Match not found', statusCode = 404}) end
local match = cjson.decode(raw)
local user = ARGV[1]
local now = tonumber(ARGV[2])
if user ~= match.player1.userId and user ~= match.player2.userId then
  return cjson.encode({error = 'You are not a participant in this match', statusCode = 403})
end
if match.status == 'active' then
  match.lastSeenAt = match.lastSeenAt or {}
  local other = user == match.player1.userId and match.player2.userId or match.player1.userId
  local otherSeen = match.lastSeenAt[other] or match.createdAt
  if ARGV[3] == 'leave' or otherSeen <= now - 120000 then
    match.status = 'abandoned'
    match.endedAt = now
    match.endReason = ARGV[3] == 'leave' and 'player_left' or 'opponent_disconnected'
    for index = 2, 3 do
      if redis.call('GET', KEYS[index]) == match.id then redis.call('DEL', KEYS[index]) end
    end
  else
    match.lastSeenAt[user] = now
  end
  redis.call('SET', KEYS[1], cjson.encode(match))
end
return cjson.encode({match = match})
`;
