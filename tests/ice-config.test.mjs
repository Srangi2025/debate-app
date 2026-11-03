import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { iceConfiguration } from "../lib/ice-config.ts";

test("unconfigured local calls retain STUN", () => {
  assert.deepEqual(iceConfiguration({}), {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }], iceTransportPolicy: "all",
  });
});

test("TURN credentials expire, verify with the relay secret, and omit that secret", () => {
  const env = { TURN_URLS: "turn:relay.example:3478?transport=udp, turns:relay.example:5349?transport=tcp", TURN_SHARED_SECRET: "test-signing-secret", WEBRTC_RELAY_ONLY: "true" };
  const config = iceConfiguration(env, 1700000000000);
  const turn = config.iceServers[1];
  assert.equal(config.iceTransportPolicy, "relay");
  assert.equal(turn.username.split(":")[0], "1700003600");
  assert.equal(turn.credential, createHmac("sha1", env.TURN_SHARED_SECRET).update(turn.username).digest("base64"));
  assert.equal(turn.urls.length, 2);
  assert.equal(JSON.stringify(config).includes(env.TURN_SHARED_SECRET), false);
  assert.notEqual(iceConfiguration(env, 1700000000000).iceServers[1].username, turn.username);
});

test("partial or invalid relay configuration fails instead of silently bypassing TURN", () => {
  for (const env of [
    { TURN_URLS: "turn:relay.example" }, { TURN_SHARED_SECRET: "secret" },
    { WEBRTC_RELAY_ONLY: "true" },
    ...["https://relay.example", "turn:relay.example?transport=invalid", "turn:user@relay.example"].map(TURN_URLS => ({ TURN_URLS, TURN_SHARED_SECRET: "secret" })),
  ]) assert.throws(() => iceConfiguration(env));
});
