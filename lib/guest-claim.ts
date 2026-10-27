// Queue allocation and guest retirement use the same Redis transaction boundary.
// The account ID must come from a verified token, never from request JSON.
export const RESERVE_GUEST_CLAIM_SCRIPT = `
local guest = ARGV[1]
local account = ARGV[2]
local prior = redis.call('GET', 'identity:' .. guest .. ':retired')
if prior and prior ~= account then return cjson.encode({error='Guest import is already in progress',statusCode=409}) end
local queued = redis.call('GET', 'user:' .. guest .. ':queue')
if queued then
  local entry = cjson.decode(queued)
  if (entry.lastSeenAt or entry.joinedAt or 0) > tonumber(ARGV[3]) - 120000 then
    return cjson.encode({error='Leave the queue before importing guest history',statusCode=409})
  end
  for _,topic in ipairs(entry.topics or {}) do redis.call('ZREM','queue:topic:' .. topic,guest) end
  redis.call('DEL','user:' .. guest .. ':queue')
end
local room = redis.call('GET', 'user:' .. guest .. ':match')
if room then
  local raw = redis.call('GET', 'match:' .. room)
  if raw and cjson.decode(raw).status == 'active' then
    return cjson.encode({error='Finish or leave your guest debate before importing history',statusCode=409})
  end
end
redis.call('SET', 'identity:' .. guest .. ':retired', account, 'EX', 300)
return cjson.encode({ok=true})
`;
