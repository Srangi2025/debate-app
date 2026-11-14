import assert from "node:assert/strict";
import { test } from "node:test";
import { pilotAccess } from "../lib/pilot-access.ts";

test("local open access preserves guests and existing accounts", () => {
  assert.equal(pilotAccess(null, {}), null);
  assert.equal(pilotAccess({ userId: "account-a", kind: "account" }, { PILOT_ACCESS_MODE: "open" }), null);
});

test("only exact verified permanent account IDs pass the invitation list", () => {
  const env = { PILOT_ACCESS_MODE: "invite-only", PILOT_ACCOUNT_IDS: " account-a, account-b " };
  assert.equal(pilotAccess({ userId: "account-a", kind: "account" }, env), null);
  assert.equal(pilotAccess({ userId: "account-b", kind: "account" }, env), null);
  for (const identity of [null, { userId: "account-a", kind: "guest" },
    { userId: "account", kind: "account" }, { userId: "account-c", kind: "account" }]) {
    assert.equal(pilotAccess(identity, env)?.status, 403);
  }
});

test("empty lists, revocation, and invalid modes deny access", () => {
  const identity = { userId: "account-a", kind: "account" };
  for (const PILOT_ACCOUNT_IDS of [undefined, "", " , ", "account-b"]) {
    assert.equal(pilotAccess(identity, { PILOT_ACCESS_MODE: "invite-only", PILOT_ACCOUNT_IDS })?.status, 403);
  }
  assert.equal(pilotAccess(identity, { PILOT_ACCESS_MODE: "invte-only" })?.status, 503);
});
