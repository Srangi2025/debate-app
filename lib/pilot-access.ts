type PilotEnvironment = {
  [key: string]: string | undefined;
  PILOT_ACCESS_MODE?: string;
  PILOT_ACCOUNT_IDS?: string;
};

export function pilotAccess(
  identity: { userId: string; kind: "guest" | "account" } | null,
  env: PilotEnvironment = process.env,
): { status: number; error: string } | null {
  const mode = env.PILOT_ACCESS_MODE?.trim() || "open";
  if (mode === "open") return null;
  if (mode !== "invite-only") {
    return { status: 503, error: "Pilot access is not configured correctly." };
  }
  const ids = (env.PILOT_ACCOUNT_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean);
  // An empty list deliberately closes access. Never accept email addresses or
  // browser-supplied identities as proof of an invitation.
  if (identity?.kind === "account" && ids.includes(identity.userId)) return null;
  return { status: 403, error: "This pilot is invite-only. Sign in with an invited account at /account." };
}
