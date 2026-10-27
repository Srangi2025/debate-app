"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { authenticatedFetch, getAuthClient, notifySessionChanged } from "@/lib/guest-auth";
import { useGuestProfile } from "@/app/components/GuestProfile";

type Activity = { queued: boolean; matchId: string | null };
type Status = { kind: "guest" | "account"; email: string | null; activity: Activity; guest: { available: boolean; username: string | null; activity: Activity } | null };

async function fetchStatus(): Promise<Status> {
  const response = await authenticatedFetch("/api/account");
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to load account status.");
  return data;
}

export default function AccountPage() {
  const { refreshProfile } = useGuestProfile();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const request = useRef(0);
  const load = useCallback(async () => {
    const generation = ++request.current;
    try {
      const data = await fetchStatus();
      if (generation === request.current) { setStatus(data); setError(""); }
    } catch (err) { if (generation === request.current) setError(err instanceof Error ? err.message : "Unable to load account status."); }
  }, []);
  useEffect(() => {
    const generation = ++request.current;
    void fetchStatus().then(data => { if (generation === request.current) setStatus(data); }).catch(err => { if (generation === request.current) setError(err.message); });
    const sync = () => void load();
    window.addEventListener("debate:session", sync);
    return () => { request.current = -1; window.removeEventListener("debate:session", sync); };
  }, [load]);
  const active = !!(status?.activity.queued || status?.activity.matchId);
  const guestActive = !!(status?.guest?.activity.queued || status?.guest?.activity.matchId);
  useEffect(() => {
    if (!active && !guestActive) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [active, guestActive, load]);

  async function authenticate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || active) return;
    const client = getAuthClient();
    if (!client) { setError("Account sign-in is not configured yet. You can continue as a guest."); return; }
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    setBusy(true); setError(""); setNotice("");
    try {
      const result = mode === "signup"
        ? await client.auth.signUp({ email, password, options: { emailRedirectTo: new URL("/account", window.location.origin).href } })
        : await client.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (!result.data.session) setNotice("Check your email to confirm the account, then sign in here. Your guest history stays available in this browser.");
      else { notifySessionChanged(result.data.session.user.id); refreshProfile(); await load(); setNotice("Signed in. You can now import the guest history from this browser."); }
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to sign in. Please retry."); }
    finally { setBusy(false); }
  }

  async function claim() {
    if (busy || guestActive) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await authenticatedFetch("/api/account/claim", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to import guest history.");
      setNotice(data.alreadyClaimed ? "There is no remaining guest history to import." : "Guest history and the saved guest name have been linked to your account. Your existing account name is preserved.");
      notifySessionChanged(); refreshProfile(); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to import guest history."); }
    finally { setBusy(false); }
  }

  async function signOut() {
    if (busy || active) return;
    setBusy(true); setError("");
    try {
      const result = await getAuthClient()?.auth.signOut({ scope: "local" });
      if (result?.error) throw result.error;
      notifySessionChanged(null); refreshProfile(); await load(); setNotice("Signed out. Account history remains private. You are continuing as a guest.");
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to sign out."); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto w-full max-w-xl px-6 py-10 text-black">
    <h1 className="text-3xl font-bold">Your account</h1>
    <p className="mt-3 text-gray-600">Keep your debate history with an account, or continue using a guest identity.</p>
    {error && <div role="alert" className="mt-5 rounded-lg bg-red-50 p-4 text-red-700">{error} <button onClick={() => void load()} className="underline">Retry status</button></div>}
    {notice && <p role="status" className="mt-5 rounded-lg bg-emerald-50 p-4 text-emerald-900">{notice}</p>}
    {active && <p className="mt-5 rounded-lg border p-4">Finish or leave your current debate or queue before switching accounts. <Link href={status?.activity.matchId ? `/match/${status.activity.matchId}` : "/queue"} className="underline">Return to your debate</Link>.</p>}
    {status?.kind === "account" ? <div className="mt-6 space-y-5">
      <p className="break-words font-medium">Signed in as {status.email || "your account"}</p>
      {status.guest && <section className="rounded-xl border p-5">
        <h2 className="font-semibold">Import this browser’s guest history</h2>
        <p className="mt-2 text-sm text-gray-600">Import completed debates and the saved name{status.guest.username ? ` “${status.guest.username}”` : ""}. Existing account names are preserved. Other guests’ history is not imported.</p>
        {guestActive && <p className="mt-3 text-sm">A guest debate or queue is still active. Sign out and finish or leave it before importing.</p>}
        <button onClick={() => void claim()} disabled={busy || guestActive} className="mt-4 rounded-lg bg-black px-4 py-3 text-white disabled:opacity-50">{busy ? "Working…" : "Import guest history"}</button>
      </section>}
      <Link href="/history" className="block underline">View debate history</Link>
      <button onClick={() => void signOut()} disabled={busy || active} className="rounded-lg border px-4 py-2 disabled:opacity-50">Sign out</button>
    </div> : <div className="mt-6 rounded-xl border p-5">
      <h2 className="text-xl font-semibold">{mode === "signin" ? "Sign in" : "Create an account"}</h2>
      <form onSubmit={authenticate} className="mt-5 space-y-4">
        <label className="block text-sm font-medium">Email<input type="email" name="email" required autoComplete="email" className="mt-2 w-full rounded-lg border px-3 py-3" /></label>
        <label className="block text-sm font-medium">Password<input type="password" name="password" required minLength={mode === "signup" ? 8 : 1} autoComplete={mode === "signup" ? "new-password" : "current-password"} className="mt-2 w-full rounded-lg border px-3 py-3" /></label>
        <button type="submit" disabled={busy || active || !status} className="rounded-lg bg-black px-5 py-3 text-white disabled:opacity-50">{busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}</button>
      </form>
      <button disabled={busy} onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); }} className="mt-5 text-sm underline">{mode === "signin" ? "Create an account instead" : "Already have an account? Sign in"}</button>
    </div>}
    <Link href="/dashboard" className="mt-7 inline-block text-sm underline">Continue to dashboard</Link>
  </main>;
}
