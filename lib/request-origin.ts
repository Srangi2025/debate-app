export function sameOriginRequest(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // Non-browser clients must still prove token and cookie ownership.
  try {
    const source = new URL(origin);
    if (!["http:", "https:"].includes(source.protocol)) return false;
    // Next's internal URL can use localhost even when the browser uses 127.0.0.1.
    // Host is the actual browser request authority; do not trust arbitrary forwarded hosts.
    const target = new URL(`${source.protocol}//${req.headers.get("host") || new URL(req.url).host}`);
    return source.origin === target.origin;
  } catch { return false; }
}
