/** Server-side credentials only; never import into client components. */
export function aiServiceHeaders(service: string, token = process.env.AI_SERVICE_TOKEN): Record<string, string> {
  const url = new URL(service);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || !["http:", "https:"].includes(url.protocol)) {
    throw new Error("Invalid AI service URL");
  }
  if (!local && (url.protocol !== "https:" || !token?.trim())) {
    throw new Error("Remote AI services require HTTPS and AI_SERVICE_TOKEN");
  }
  if (token && (token.trim() !== token || /\s/.test(token))) throw new Error("Invalid AI service token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
