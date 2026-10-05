// Per-topic sorted indexes keep selection proportional to selected topics, not queue size.
// All claims, index cleanup, and publication to both participants happen atomically.
export const QUEUE_SCRIPT = `
local user = ARGV[1]
local now = tonumber(ARGV[2])
local action = ARGV[3]
local prefix = ARGV[7]
local function userKey(id, suffix) return prefix .. 'user:' .. id .. ':' .. suffix end
local function topicKey(topic) return prefix .. 'queue:topic:' .. topic end
local function remove(id)
  local raw = redis.call('GET', userKey(id, 'queue'))
  if raw then
    local entry = cjson.decode(raw)
    for _, topic in ipairs(entry.topics) do redis.call('ZREM', topicKey(topic), id) end
  end
  redis.call('DEL', userKey(id, 'queue'))
end
if action == 'leave' then
  remove(user)
  return cjson.encode({ok = true})
end
local existing = redis.call('GET', userKey(user, 'match'))
if existing then return cjson.encode({matched = true, matchId = existing}) end
local raw = redis.call('GET', userKey(user, 'queue'))
local me = raw and cjson.decode(raw) or nil
if me and me.joinedAt <= now - 120000 then remove(user); me = nil end
if action == 'status' then
  return cjson.encode({matched = false, queued = me ~= nil})
end
local topics = cjson.decode(ARGV[5])
local joinedAt = me and me.joinedAt or now
remove(user)
local opponent = nil
local oldest = nil
for _, topic in ipairs(topics) do
  local key = topicKey(topic)
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now - 120000)
  local first = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  if #first > 0 then
    local score = tonumber(first[2])
    if not oldest or score < oldest or (score == oldest and first[1] < opponent) then
      opponent = first[1]; oldest = score
    end
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
    player1 = {userId = opponent, username = other.username},
    player2 = {userId = user, username = ARGV[4]}}
  redis.call('SET', prefix .. 'match:' .. matchId, cjson.encode(match))
  redis.call('SET', userKey(opponent, 'match'), matchId)
  redis.call('SET', userKey(user, 'match'), matchId)
  return cjson.encode({matched = true, matchId = matchId})
end
redis.call('SET', userKey(user, 'queue'), cjson.encode({userId = user, username = ARGV[4], topics = topics, joinedAt = joinedAt}))
for _, topic in ipairs(topics) do redis.call('ZADD', topicKey(topic), joinedAt, user) end
return cjson.encode({matched = false, queued = true})
`;

export type QueueResponse = { matched?: boolean; matchId?: string; queued?: boolean; ok?: boolean };
