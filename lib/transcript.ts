import { SCHEDULE_LIVE_LUA } from "./live-feedback.ts";

export const MAX_SEGMENT_LENGTH = 2000;
export const MAX_AUDIO_BYTES = 1_000_000;
export type TranscriptSegment = {
  id: string;
  userId: string;
  username: string;
  side: "A" | "B";
  source: "speech" | "text";
  text: string;
  createdAt: number;
};

// Ownership, limits, and duplicate detection are checked again atomically after
// inference, so an in-flight audio request cannot append after submission.
export const APPEND_TRANSCRIPT_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({error = 'Match not found', statusCode = 404}) end
local match = cjson.decode(raw)
local user = ARGV[1]
if not match.player1 or not match.player2 then
  return cjson.encode({error = 'Both participants are required', statusCode = 409})
end
local player = nil
local side = nil
if user == match.player1.userId then player = match.player1; side = 'A'
elseif user == match.player2.userId then player = match.player2; side = 'B'
else return cjson.encode({error = 'You are not a participant in this match', statusCode = 403}) end
local identity = user .. ':' .. ARGV[2]
local saved = redis.call('HGET', KEYS[4], identity)
if saved then return cjson.encode({segment = cjson.decode(saved), duplicate = true}) end
if match.status ~= 'active' or redis.call('HEXISTS', KEYS[2], user) == 1 then
  return cjson.encode({error = 'Your transcript is already closed for this debate', statusCode = 409})
end
local length = tonumber(ARGV[6])
local total = tonumber(redis.call('HGET', KEYS[5], user) or '0')
local count = tonumber(redis.call('HGET', KEYS[5], user .. ':count') or '0')
if total + length + 1 > 20000 or count >= 500 then
  return cjson.encode({error = 'Your transcript has reached its limit. Submit your saved debate.', statusCode = 413})
end
local segment = {id = ARGV[2], userId = user, username = player.username, side = side,
  text = ARGV[3], source = ARGV[4], createdAt = tonumber(ARGV[5])}
local encoded = cjson.encode(segment)
redis.call('RPUSH', KEYS[3], encoded)
redis.call('HSET', KEYS[4], identity, encoded)
redis.call('HINCRBY', KEYS[5], user, length + 1)
redis.call('HINCRBY', KEYS[5], user .. ':count', 1)
${SCHEDULE_LIVE_LUA}
return cjson.encode({segment = segment})
`;

