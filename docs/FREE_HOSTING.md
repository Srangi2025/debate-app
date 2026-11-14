# Zero-budget preliminary hosting

Owner direction, November 14, 2026: use free services only. Do not upgrade plans,
enable paid inference, or provision resources that require spending approval.

## Recommended arrangement

| Component | Option | Practical limit |
| --- | --- | --- |
| Next.js web | Existing Vercel Hobby project | Personal, non-commercial use and usage quotas |
| Accounts/history | Existing Supabase Free project | Can pause after one week of inactivity; recovery may be needed |
| Coordination | Upstash Redis Free, if the existing database is on that plan | Command/bandwidth quotas; check its actual plan in the account |
| AI and worker | Existing computer, during scheduled tests | Computer must stay awake with Ollama, Python, and the Node worker running |
| Remote speech/API access | Authenticated HTTPS tunnel to Python | Tunnel setup is still required; temporary Quick Tunnels are for testing |
| WebRTC relay | Consider Cloudflare Realtime TURN's included allowance | Requires a new credential-provider integration; usage above the allowance is billed |

This is a recommendation, not a completed backend deployment. Local compute
avoids an additional hosting subscription but still uses the owner's hardware,
electricity, and internet connection. The worker must use the same cloud Redis
and PostgreSQL as Vercel. Only Python needs inbound HTTPS access; keep Ollama
private, require service authentication, and use the shared server-only token on
Vercel. Do not expose the unauthenticated development API.

The existing TURN implementation issues coturn shared-secret credentials.
Cloudflare TURN uses its own credential-generation API; setting its hostname in
the current coturn configuration is not sufficient. Do not treat an included
allowance as a hard zero-dollar billing cap or enable it without checking account
billing controls.

## Other options

- Render Free can host small HTTP services but sleeps after 15 minutes without
  inbound traffic. Background workers do not have a Free instance option. It is
  not a direct replacement for the current continuous worker and local model.
- A free-tier virtual machine could combine Python, Ollama, and the worker if
  available hardware, memory, and provider terms fit. Availability and practical
  model throughput are unverified; no such VM has been provisioned.
- Fully local hosting is the simplest option during development, but does not
  provide a permanently available public demo.

## Verified state, November 14

- Existing Vercel project: `srangi2025s-projects/debate-app`; team plan: Hobby.
- Public preliminary website: https://debate-app-gamma.vercel.app. The homepage,
  account page, and dashboard returned HTTP 200; the leaderboard API returned
  HTTP 200. Session creation returned HTTP 500, so functioning pages do not
  establish a working debate/account backend.
- Configured Supabase project `urqlekmkssfaqcihbxef` had no public DNS A record
  (NXDOMAIN); the SQL pooler reported that its tenant/user was not found.
  Restore/check the existing project in the dashboard before changing
  credentials or creating a replacement. Database/auth operational verification
  remains blocked until it returns.
- Configured Redis answered `PING` successfully. Its billing plan was not checked.
- Vercel production environment metadata lists Supabase, PostgreSQL/CA, and
  Upstash configuration, but no remote AI URL/token, TURN, or pilot allowlist.
  Production secret values were not downloaded. No managed AI/worker or
  cross-network relay flow has been verified.

## References

- [Vercel Hobby](https://vercel.com/docs/plans/hobby)
- [Supabase Free pricing and inactivity policy](https://supabase.com/pricing)
- [Upstash Redis pricing](https://upstash.com/pricing/redis)
- [Render Free limits](https://render.com/docs/free)
- [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
- [Cloudflare Realtime pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/)

Provider allowances can change. Keep the pilot audience small and check usage
before scheduled tests; quotas and successful builds do not establish capacity.
