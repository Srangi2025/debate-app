import { createHmac, randomUUID } from "node:crypto";

/** Coturn REST credentials: the shared signing secret stays on the server. */
export function iceConfiguration(env: NodeJS.ProcessEnv = process.env, now = Date.now()): RTCConfiguration {
  const urls = (env.TURN_URLS || "").split(",").map(url => url.trim()).filter(Boolean);
  const secret = env.TURN_SHARED_SECRET;
  const relayOnly = env.WEBRTC_RELAY_ONLY === "true";
  if (Boolean(urls.length) !== Boolean(secret)) throw new Error("TURN URLs and shared secret must be configured together");
  if (urls.some(url => !/^turns?:[^\s/?#@]+(?:\?transport=(?:udp|tcp))?$/.test(url))) {
    throw new Error("Invalid TURN URL");
  }
  if (relayOnly && !urls.length) throw new Error("Relay-only mode requires TURN");

  const iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  if (urls.length && secret) {
    // One hour covers the current 6.5-minute debate and setup/reload time.
    const username = `${Math.floor(now / 1000) + 3600}:${randomUUID()}`;
    const credential = createHmac("sha1", secret).update(username).digest("base64");
    iceServers.push({ urls, username, credential });
  }
  return { iceServers, iceTransportPolicy: relayOnly ? "relay" : "all" };
}
