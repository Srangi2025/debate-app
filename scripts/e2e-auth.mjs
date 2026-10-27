// Local-only provider fixture. No real accounts, credentials, or email are used.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

export async function authFixture() {
  const users = new Map(), sessions = new Map(), requests = [];
  function createUser(email, password, confirmed = true) {
    const now = new Date().toISOString();
    const user = { id: randomUUID(), aud: "authenticated", role: "authenticated", email, email_confirmed_at: confirmed ? now : undefined,
      created_at: now, updated_at: now, app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [], is_anonymous: false };
    users.set(email, { user, password }); return user;
  }
  function issue(user) {
    const payload = { sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
    const token = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify(payload)).toString("base64url"), Buffer.from(randomUUID()).toString("base64url")].join(".");
    const session = { access_token: token, refresh_token: randomUUID(), token_type: "bearer", expires_in: 3600, expires_at: payload.exp, user };
    sessions.set(token, session); return session;
  }
  const server = createServer(async (req, res) => {
    res.on("finish", () => requests.push({ method: req.method, path: new URL(req.url, "http://localhost").pathname, status: res.statusCode }));
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization,apikey,x-client-info,content-type,x-supabase-api-version");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Content-Type", "application/json");
    const send = (status, data) => { res.statusCode = status; res.end(data === undefined ? undefined : JSON.stringify(data)); };
    if (req.method === "OPTIONS") return send(204);
    let body = {};
    try { let text = ""; for await (const part of req) text += part; body = text ? JSON.parse(text) : {}; } catch { return send(400, { message: "Invalid fixture request" }); }
    const url = new URL(req.url, "http://localhost");
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    if (url.pathname === "/auth/v1/user") return sessions.has(token) ? send(200, sessions.get(token).user) : send(401, { message: "Invalid token", code: "bad_jwt" });
    if (url.pathname === "/auth/v1/signup") {
      if (users.has(body.email)) return send(400, { message: "User already registered" });
      const user = createUser(body.email, body.password, !body.email.startsWith("confirm-"));
      return send(200, user.email_confirmed_at ? issue(user) : { user, session: null });
    }
    if (url.pathname === "/auth/v1/token") {
      const record = users.get(body.email);
      if (!record || record.password !== body.password) return send(400, { message: "Invalid login credentials", code: "invalid_credentials" });
      if (!record.user.email_confirmed_at) return send(400, { message: "Email not confirmed", code: "email_not_confirmed" });
      return send(200, issue(record.user));
    }
    if (url.pathname === "/auth/v1/logout") { sessions.delete(token); return send(204); }
    if (url.pathname === "/auth/v1/settings") return send(200, { external: { email: true }, disable_signup: false });
    return send(404, { message: "Unknown fixture endpoint" });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, createUser, requests,
    confirm(email) { users.get(email).user.email_confirmed_at = new Date().toISOString(); },
    token(email) { return [...sessions.values()].find(session => session.user.email === email)?.access_token; },
    close: () => new Promise(resolve => server.close(resolve)),
  };
}
