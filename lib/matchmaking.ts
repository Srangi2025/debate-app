// Per-topic FIFO indexes search only players with a shared topic.
// All claims, index cleanup, and publication to both participants happen atomically.
export const QUEUE_SCRIPT = `
local user = ARGV[1]
local now = tonumber(ARGV[2])
local action = ARGV[3]
local prefix = ARGV[7]
local rating = tonumber(ARGV[8]) or 1500
local function userKey(id, suffix) return prefix .. 'user:' .. id .. ':' .. suffix end
local function topicKey(topic) return prefix .. 'queue:topic:' .. topic end
if redis.call('GET', prefix .. 'identity:' .. user .. ':retired') then
  return cjson.encode({error='This guest identity is being imported. Reload to continue.',statusCode=409})
end
local function remove(id)
  local raw = redis.call('GET', userKey(id, 'queue'))
  if raw then
    local entry = cjson.decode(raw)
    for _, topic in ipairs(entry.topics) do redis.call('ZREM', topicKey(topic), id) end
  end
  redis.call('DEL', userKey(id, 'queue'))
end
local function abandon(match, reason)
  match.status = 'abandoned'
  match.endedAt = now
  match.endReason = reason
  redis.call('SET', prefix .. 'match:' .. match.id, cjson.encode(match))
  for _, player in ipairs({match.player1, match.player2}) do
    if redis.call('GET', userKey(player.userId, 'match')) == match.id then
      redis.call('DEL', userKey(player.userId, 'match'))
    end
  end
end
local function activeMatch(id)
  local matchId = redis.call('GET', userKey(id, 'match'))
  if not matchId then return nil end
  local raw = redis.call('GET', prefix .. 'match:' .. matchId)
  local match = raw and cjson.decode(raw) or nil
  if match and match.status == 'active'
    and type(match.player1) == 'table' and type(match.player2) == 'table'
    and (match.player1.userId == id or match.player2.userId == id) then
    local seen = match.lastSeenAt or {}
    local firstSeen = seen[match.player1.userId] or match.createdAt or 0
    local secondSeen = seen[match.player2.userId] or match.createdAt or 0
    if firstSeen > now - 120000 and secondSeen > now - 120000 then return match end
    abandon(match, 'opponent_disconnected')
  end
  redis.call('DEL', userKey(id, 'match'))
  return nil
end
if action == 'leave' then
  remove(user)
  -- A second player may have matched this user just before cancellation.
  local match = activeMatch(user)
  if match then abandon(match, 'player_left') end
  return cjson.encode({ok = true})
end
local existing = activeMatch(user)
if existing then
  remove(user)
  return cjson.encode({matched = true, matchId = existing.id})
end
local raw = redis.call('GET', userKey(user, 'queue'))
local me = raw and cjson.decode(raw) or nil
if me and (me.lastSeenAt or me.joinedAt) <= now - 120000 then remove(user); me = nil end
if action == 'status' and not me then
  return cjson.encode({matched = false, queued = false})
end

-- Status polls also attempt matchmaking so the rating window can expand.
local topics = action == 'status' and me.topics or cjson.decode(ARGV[5])
local username = action == 'status' and me.username or ARGV[4]
local joinedAt = me and me.joinedAt or now
rating = action == 'status' and (tonumber(me.rating) or 1500) or rating

remove(user)
local opponent = nil
local bestJoinedAt = nil

-- Gradually widen the acceptable skill range as this user waits.
local waitMs = now - joinedAt
local maxDifference = nil

if waitMs < 10000 then
  maxDifference = 100
elseif waitMs < 20000 then
  maxDifference = 200
elseif waitMs < 30000 then
  maxDifference = 400
end

-- Read FIFO candidates in pages. Continue past incompatible/expired entries
-- rather than hiding eligible players behind a fixed shortlist of 25 users.
for _, topic in ipairs(topics) do
  local key = topicKey(topic)
  local offset = 0
  local found = false
  while not found do
    local candidates = redis.call('ZRANGE', key, offset, offset + 49)
    if #candidates == 0 then break end
    local retained = 0
    for _, candidate in ipairs(candidates) do
      local candidateRaw = redis.call('GET', userKey(candidate, 'queue'))
      if not candidateRaw then
        redis.call('ZREM', key, candidate)
      else
        local other = cjson.decode(candidateRaw)
        local candidateJoinedAt = tonumber(other.joinedAt) or now
        local lastSeenAt = tonumber(other.lastSeenAt) or candidateJoinedAt
        local sharesTopic = false
        for _, theirs in ipairs(other.topics) do
          if topic == theirs then sharesTopic = true; break end
        end
        if lastSeenAt <= now - 120000 then
          remove(candidate)
        elseif activeMatch(candidate) then
          -- Matched players cannot occupy another room through a stale index.
          remove(candidate)
        elseif not sharesTopic then
          redis.call('ZREM', key, candidate)
        else
          retained = retained + 1
          local difference = math.abs(rating - (tonumber(other.rating) or 1500))
          local otherWaitMs = now - candidateJoinedAt
          local otherMaxDifference = nil
          if otherWaitMs < 10000 then otherMaxDifference = 100
          elseif otherWaitMs < 20000 then otherMaxDifference = 200
          elseif otherWaitMs < 30000 then otherMaxDifference = 400 end
          local myAllows = maxDifference == nil or difference <= maxDifference
          local theirAllows = otherMaxDifference == nil or difference <= otherMaxDifference
          if candidate ~= user and myAllows and theirAllows then
            -- First eligible candidate in this topic is its oldest. Across
            -- topics use joined time, then user ID for deterministic ties.
            if opponent == nil or candidateJoinedAt < bestJoinedAt
              or (candidateJoinedAt == bestJoinedAt and candidate < opponent) then
              opponent = candidate
              bestJoinedAt = candidateJoinedAt
            end
            found = true
            break
          end
        end
      end
    end
    -- Removed entries shift the next page left; advance by retained entries.
    offset = offset + retained
    if #candidates < 50 then break end
  end
end
if opponent then
  local other = cjson.decode(redis.call('GET', userKey(opponent, 'queue')))
  local shared = {}
  for _, topic in ipairs(topics) do
    for _, theirs in ipairs(other.topics) do
      if topic == theirs then table.insert(shared, topic); break end
    end
  end
  remove(opponent)
  local matchId = ARGV[6]
  local match = {id = matchId, topics = shared, createdAt = now, status = 'active',
    lastSeenAt = {[opponent] = now, [user] = now},
    player1 = {userId = opponent, username = other.username, rating = tonumber(other.rating) or 1500},
    player2 = {userId = user, username = username, rating = rating}}
  redis.call('SET', prefix .. 'match:' .. matchId, cjson.encode(match))
  redis.call('SET', userKey(opponent, 'match'), matchId)
  redis.call('SET', userKey(user, 'match'), matchId)
  return cjson.encode({matched = true, matchId = matchId})
end
redis.call('SET', userKey(user, 'queue'), cjson.encode({
  userId = user,
  username = username,
  topics = topics,
  joinedAt = joinedAt,
  lastSeenAt = now,
  rating = rating
}))
for _, topic in ipairs(topics) do redis.call('ZADD', topicKey(topic), joinedAt, user) end
return cjson.encode({matched = false, queued = true})
`;

export type QueueResponse = { matched?: boolean; matchId?: string; queued?: boolean; ok?: boolean; error?: string; statusCode?: number };
