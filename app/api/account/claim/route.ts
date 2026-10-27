import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authenticate, currentGuest } from "@/lib/server-auth";
import { historyStore } from "@/lib/history-store";
import { redis } from "@/lib/redis";
import { RESERVE_GUEST_CLAIM_SCRIPT } from "@/lib/guest-claim";
import { sameOriginRequest } from "@/lib/request-origin";

export async function POST(req: Request) {
  // Require same-origin browser intent as well as the verified account token.
  if (!sameOriginRequest(req)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  let guest: string | null = null;
  let account: string | undefined;
  let committed = false;
  try {
    const auth = await authenticate(req);
    if (auth.response) return auth.response;
    if (auth.kind !== "account") return NextResponse.json({ error: "Sign in to a permanent account before importing history" }, { status: 401 });
    account = auth.userId;
    const store = await cookies();
    const credential = store.get("debate-guest")?.value;
    guest = await currentGuest(credential);
    if (!guest) return NextResponse.json({ imported: 0, alreadyClaimed: true });
    const reserved = await redis.eval<unknown[], { error?: string; statusCode?: number }>(RESERVE_GUEST_CLAIM_SCRIPT, [], [guest, account, Date.now()]);
    if (reserved.error) return NextResponse.json({ error: reserved.error }, { status: reserved.statusCode ?? 409 });
    if (!historyStore().profile(guest)) {
      const legacy = await redis.hget<unknown>("users:usernames", guest);
      if (legacy != null) historyStore().saveProfile(guest, String(legacy));
    }
    const result = historyStore().claimGuest(guest, account);
    committed = true;
    await redis.expire(`identity:${guest}:retired`, 30 * 86400).catch(() => {});
    if (credential) await redis.del(`guest-session:${credential}`).catch(() => {});
    store.delete("debate-guest");
    const username = historyStore().profile(account);
    if (username) await redis.hset("users:usernames", { [account]: JSON.stringify(username) }).catch(() => {});
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Guest history could not be imported. Your saved debates have been preserved." }, { status: 503 });
  } finally {
    if (guest && account && !committed) await redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0", [`identity:${guest}:retired`], [account]).catch(() => {});
  }
}
