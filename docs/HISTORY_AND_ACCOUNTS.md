# Step 5: history and accounts

Phase: **5 — durable debate history, account sign-in, and guest-history import**.
Rating updates remain disabled. This phase reuses the live matching,
transcription, and grounded judging flows from Steps 1–4.

## Storage architecture

Redis remains the live coordination store. Completed debate history, display
names, guest-session credential hashes, and guest-to-account ownership links
are stored in SQLite using Node's built-in `node:sqlite` API.

- Default database: `data/debate-history.sqlite`, ignored by Git.
- Override with `HISTORY_DB_PATH` in root `.env.local` or the process environment.
- The web process and worker must use the same database file on a persistent
  **local filesystem on one host**. WAL mode coordinates concurrent processes;
  this is not a shared database across unrelated serverless instances.
- Schema: [db/history.sql](../db/history.sql), automatically initialized on first
  use. SQL schema version 1 is recorded with `PRAGMA user_version`.
- SQLite uses WAL, full synchronization, bound SQL parameters, foreign keys,
  indexed membership/date lookups, and a five-second lock wait.
- The database contains private debate data; its directory/files are created
  with restrictive permissions. Back it up outside ephemeral application storage.

Tables:

| Table | Purpose |
| --- | --- |
| `history_matches` | Immutable completed room, canonical result, segments, and frozen submissions |
| `history_members` | Stable original participant IDs and current history owners |
| `guest_claims` | One-way guest-to-account ownership mapping |
| `profiles` | Durable display names |
| `guest_sessions` | SHA-256 hashes of random guest credentials and their expiry |

Supabase provides **authentication only** in this phase. The SQLite schema is
not a PostgreSQL migration and must not be pasted into the Supabase SQL editor.
No Supabase server secret or database password is required by this implementation.
A shared PostgreSQL adapter is future work for deployments with separate hosts.

## Saving a completed debate

The final judging Redis transaction publishes the room ID to `history:pending`
while saving its result. This prevents a worker interruption between finalization
and archive scheduling from silently losing the archive request.

The worker reads both frozen submissions, the speaker-labelled transcript, and
the canonical final result. A SQL transaction inserts the immutable snapshot and
both membership rows. Duplicate delivery/concurrent workers cannot replace a
saved result or add another participant. Only completed two-player debates are
accepted.

Archive failures leave the original result/submissions untouched and reschedule
archival after five seconds. The worker processes archival alongside final/live
jobs. Redis persistence is still required for pending jobs that have not reached
SQLite; a successful archive remains readable after Redis loses the room.

## Account setup with a replacement Supabase project

1. Create or select an active project in your own Supabase organization. See
   [Supabase's Next.js quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs).
2. Obtain the project URL and **publishable** key from the project connection/API
   settings. The official [API key guide](https://supabase.com/docs/guides/getting-started/api-keys)
   explains the key types. Do not put a secret/service key in a `NEXT_PUBLIC_*` variable.
3. Set these in the repository-root `.env.local`:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://your-replacement-project.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   HISTORY_DB_PATH=./data/debate-history.sqlite
   ```

4. Enable email/password authentication. Configure the site URL for your app,
   and allow `http://localhost:3000/account` as the local confirmation redirect.
   If you use `127.0.0.1`, add that exact origin/path separately. See Supabase's
   [redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls).
5. Restart `npm run dev` so the browser bundle uses the replacement project.
6. Open `/account`, create an account, and complete email confirmation when
   required. Sign in from the browser holding your guest history, then explicitly
   choose **Import guest history**.

Changing Supabase projects does not transfer users from the previous provider.
Previously imported history remains owned by its original account ID; provider
migration requires a separate verified identity-transfer process. Do not manually
assign those rows to another account based on matching email text.

## Identity and access rules

- The backend verifies account bearer tokens with Supabase `auth.getUser`; decoded
  JWT payloads and request-supplied user IDs are not trusted.
- Guests continue using random HTTP-only cookies. Durable hashed credentials let
  an established guest session survive Redis data loss until cookie expiry.
- Sign-in alone does not silently import guest data. Import requires a verified
  permanent account **and** the browser's current guest credential.
- A Redis reservation prevents an in-flight queue join from allocating a guest
  while its history is being claimed. Queued/live guests must finish or leave
  first. Expired queue presence is cleaned instead of permanently blocking import.
- A guest can be claimed by only one account. Repeated claims are idempotent.
  Retired guest credentials cannot restore access or be claimed by a second account.
- SQL membership ownership changes; original room participants, names, speaker
  labels, transcripts, and AI evidence remain unchanged.
- An archive arriving after import resolves its original guest participant to
  the account owner, so delayed judging/archive delivery remains accessible.
- Existing account names are preserved; a guest name is copied only when the
  account has no saved name.
- Signing out returns to a guest identity and removes account-history access.
  Browser-only cached names are scoped to their owner to prevent account/guest
  name leakage.
- History queries always filter by the authenticated owner. Unknown/private IDs
  return 404. The guest import endpoint ignores client-supplied guest/account IDs.

Email/password handling, confirmation, session refresh, and local sign-out use
Supabase's SDK. Passwords and provider session tokens are not written to SQLite.
The current UI supports email/password accounts; additional identity providers
and account deletion/retention tools are not part of this phase.

## Pages and APIs

| Route | Behavior |
| --- | --- |
| `/history` | Owner-filtered completed debates with stable cursor pagination |
| `/history/[id]` | Saved rubric result, evidence cards, and original transcript |
| `/account` | Sign-up, confirmation guidance, sign-in/out, explicit guest import |
| `GET /api/history` | Authenticated owner's history; optional opaque cursor |
| `GET /api/history/[id]` | Owner-authorized SQL snapshot |
| `GET /api/account` | Verified identity and current guest/activity status |
| `POST /api/account/claim` | Cookie-proven, account-authenticated import |
| `GET /api/result/[id]` | Uses an authorized SQL result when archived; otherwise the live Redis result |

History is available for cookie guests before account creation. SQL access does
not depend on Redis retaining the old room. Legacy debates without per-segment
capture show their frozen side-by-side submitted transcripts instead.

## Initialization, backfill, backup, and restore

From the repository root:

```bash
npm run history:check
# Archive older completed Redis rooms that still have both submissions.
npm run history:backfill
# Choose a NEW destination. Existing backups are never overwritten.
npm run history:backup -- /absolute/path/to/new-history-backup.sqlite
```

Backfill uses Redis SCAN and preserves source records. It also copies unexpired
legacy guest credentials as hashes without extending their Redis lifetime, and
imports existing display names only when the durable profile is absent. Completed rooms missing
required submissions cannot recover those transcripts; they are reported as
skipped. This is an administrative command, not an unauthenticated public route.

Backup uses SQLite's online backup API and checks the destination's integrity;
copying just a live `.sqlite` file without its WAL can miss committed data.
Schedule backups through your process manager for a deployed installation.

To restore, stop both web and worker processes, preserve the current database
and sidecars, restore the chosen verified backup to a **new database path**, set
`HISTORY_DB_PATH` to that path, restart, and run `history:check`. This avoids mixing
an old WAL with a restored database. Test the restore before replacing production
storage. Guest credential expiry and Supabase token verification still apply.

For Redis, use a project-specific persistent data directory, AOF/RDB persistence,
and backups appropriate to the deployment. This phase does not silently change
a shared Redis server's global configuration. Durable SQL history protects
completed archived debates; it cannot resurrect live jobs lost before archival.

## Validation

The current regression run passed **68 Node tests and 40 Python tests**, plus
TypeScript, lint, and the production build. The automated tests exercise
participant-only history, stable pagination,
immutable snapshots, SQL parameter binding, guest expiry, one-owner claims,
name preservation, late archival, reopen/backup recovery, capture-to-judge-to-
archive integration, retry/concurrent archival, queue/claim races, and origin
checks. Existing Steps 1–4 regressions remain part of `npm test`.

```bash
npm test
npm run lint
npm run build
cd ai-service
.venv/bin/python -m pytest tests -q
```

The opt-in browser run uses real web/Redis/SQLite/AI services and an **isolated
local authentication-provider fixture**. It creates no real Supabase accounts
and sends no email. It checks the application's SDK/auth contract rather than
claiming the replacement live project has been verified.

```bash
# Install a Playwright browser if local Google Chrome is unavailable.
npx playwright install chromium
# Redis, Python speech/judge service, and Ollama must already be running.
# The default Redis database 15 must be empty and is reserved for this run.
npm run verify:step5
# To include actual speech recognition, supply a valid spoken PCM WAV fixture:
E2E_SPEECH_WAV=/absolute/path/to/spoken-16khz-mono.wav npm run verify:step5
```

`E2E_REDIS_URL` can select another **empty nonzero** test database; database 0 and
occupied databases are refused. The run copies the tracked/unignored source into a temporary checkout, symlinks
the installed dependencies, starts its isolated app on port 3100, uses a temporary
SQL file, and cleans only its dedicated test database. Main-app generated files
and configuration are not rewritten by the test run. Outputs
are ignored under `data/e2e-artifacts`. `E2E_PORT`, `E2E_AI_URL`, and
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` can adjust local test services/browser selection.

Live replacement-project reachability, confirmation delivery, and a real account
login must still be verified after its settings are provided. Do not describe a
local auth-fixture pass as a successful live Supabase rollout.

The October 26, 2026 live check could not resolve the configured Supabase Auth
hostname (`ENOTFOUND`). Cloud Redis passed its connection check. Correct the
Supabase project URL and matching publishable key before testing real accounts.

The local browser integration also checks that signed-in accounts can pair and
save contributions using their verified account IDs.

The local browser integration passed with an actual spoken WAV contribution,
WebRTC connection, text fallback, transcript reload, live feedback, final grounded
judging, SQL archival, explicit account import, forged-token/ID rejection, active
room guards, logout privacy, confirmation/sign-in, Redis loss, and process restart.
Auth provider calls used the isolated fixture; no replacement live project was used.
