# Invite-only pilot deployment

Owner direction, November 3, 2026: retain Vercel for the website and start with a
small invite-only audience. The local prototype is not yet ready for this deployment.

## Account connectivity

The existing Supabase project was restored on November 3. Auth health/settings
return HTTP 200 with the original configured URL and publishable key. The owner
confirmed real signup/sign-in and the guest-import UI. Auto-confirm is enabled;
confirmation-email delivery is not yet tested.

1. Keep the restored existing project; recreation is unnecessary.
2. Set the current Project URL and matching publishable key from the dashboard
   into `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in
   `.env.local` and the intended Vercel environments. Do not use a service-role
   or secret key for these public variables.
3. Configure Auth's Site URL for the stable pilot hostname and allowed redirect
   URLs for confirmation flows. Confirm email/password auth is enabled.
4. Restart local development; redeploy Vercel after updating public variables.
5. Verify real signup, confirmation, login, sign-out, private history access, and
   explicit guest import before inviting users. The previous tests used a fixture.

References: [project pausing](https://supabase.com/docs/guides/platform/free-project-pausing),
[API keys](https://supabase.com/docs/guides/getting-started/api-keys).

## Make storage and workers compatible with Vercel

The default SQLite database stores history, profiles, guest credentials, and
account import ownership. Vercel's temporary writable filesystem cannot provide
shared durable storage for these records. Moving the database to `/tmp` does not
solve this. The PostgreSQL adapter is implemented; connection setup and migration
are required before deploying the account/history implementation to Vercel.

Use the existing Supabase project's Postgres database for these records, while
retaining Redis for live coordination. The adapter preserves participant
authorization, immutable snapshots, import ownership, and archive-outbox recovery.
Remote connections require verified TLS; Vercel pools use one connection per
warm instance. Named prepared statements are not used. Ownership-changing writes
are serialized with transaction-scoped advisory locks for this pilot.

### Database setup and cutover

1. In Supabase **Connect → Direct → Transaction pooler**, copy the URI. Replace
   the password placeholder with the project's database password, without square
   brackets. This is separate from dashboard/app account passwords. If lost,
   reset it in Database settings and update existing database clients.
2. Save the URI as `HISTORY_DATABASE_URL` in ignored `.env.local`. URL-encode
   special characters in the password. Never put it in Git or chat.
3. Download the CA certificate from **Database → Settings → SSL Configuration**.
   Locally, save it as ignored `supabase-ca.pem` and set
   `HISTORY_DATABASE_CA_FILE=./supabase-ca.pem`. On Vercel, use
   `HISTORY_DATABASE_CA` containing the certificate PEM; local file paths will
   not be available there. Keep verification enabled if a certificate fails.
4. Stop web and worker writes, then back up the local source. The empty URI in
   this command deliberately selects SQLite for its online backup:

   ```bash
   HISTORY_DATABASE_URL= npm run history:backup
   npm run history:postgres:init
   npm run history:postgres:import
   npm run history:check
   ```

   The importer defaults to `HISTORY_DB_PATH` or `data/debate-history.sqlite`.
   Supply a source path after `--` to import a verified backup instead. It reads
   the source without modifying it and commits the target atomically. Retries
   preserve existing snapshots and names; conflicting snapshots or owners abort
   the import. Expired credentials are not imported and expiry is not extended.
5. Configure the same database URI/CA for web and worker before restarting.
   Do not leave one process writing SQLite while the other uses PostgreSQL.
6. Verify account sign-in, guest import, private history/results, and a completed
   debate after restart. Vercel preview and production should use distinct test
   and production databases/Redis namespaces to avoid mixing pilot records.

November 3 cutover completed with the supplied URI and downloaded Supabase CA.
Verified TLS/database authentication and private schema initialization succeeded.
The live import preserved one profile and ten unexpired guest sessions; the
source contained zero archived debates/claims. A verified SQLite backup and
the original remain available. Web and worker restarted with shared Postgres.
All five private tables have row-level security enabled and browser roles lack
schema access. Live local session/profile/history/account routes returned HTTP
200 after cutover. Validation passed 83 Node tests, 40 Python tests, lint,
TypeScript and the production build. A full hosted debate and real
account-history flow after cutover still need verification.

References: [Postgres connections](https://supabase.com/docs/guides/database/connecting-to-postgres),
[verified SSL](https://supabase.com/docs/guides/platform/ssl-enforcement).

### Vercel release

November 14 verification found an existing Hobby deployment at
https://debate-app-gamma.vercel.app and authenticated Vercel CLI access. This
checkout is linked to `srangi2025s-projects/debate-app`. The homepage, account,
and dashboard load; session creation currently fails while the configured
Supabase project's hostname and SQL tenant are unavailable. Restore the project
and recheck auth, SQL, and session creation before claiming operational readiness.
See [free hosting options and current checks](FREE_HOSTING.md).

For an unlinked checkout, run `npx vercel login`, then `npx vercel link` to select
the existing project. Set database URI/CA, Supabase
public URL/key, shared Redis, and reachable authenticated AI service settings
in the intended Vercel environment before `npx vercel --prod`. Public variables
are embedded at build time, so redeploy after changing them. Use `npm ci` to
install the reviewed lockfile. Do not create an unrelated temporary deployment.

The judging worker requires an external managed process; Python/Ollama also need
an appropriate external host. Select hosting and budget before provisioning.
The AI service now supports bearer authentication on all HTTP endpoints.
Before connecting Vercel, set `AI_REQUIRE_AUTH=true` and a cryptographically
random `AI_SERVICE_TOKEN` on Python; configure the same token on web and worker.
Use an HTTPS reverse proxy and keep Ollama private. A missing token with required
auth returns 503; incorrect or absent credentials return 401 before inference.
Health probes must send the bearer token too. Node clients require HTTPS and a
token for all non-loopback destinations and reject redirects. For separate speech
hosting, set `TRANSCRIPTION_SERVICE_TOKEN` to that service’s token. Local loopback
development remains usable without tokens. These controls are implemented and
tested locally; no external endpoint has been provisioned or verified. Web and
worker must share Redis and the durable SQL backend. Worker/AI hosting is still
an open choice; frontend publication alone does not make judging operational.

References: [Vercel runtimes](https://vercel.com/docs/functions/runtimes),
[function limits](https://vercel.com/docs/functions/limitations).

## Configure and verify TURN

The app now fetches `/api/webrtc/config?matchId=...` before creating a peer
connection. Only an authorized participant in an active room receives credentials;
responses use `Cache-Control: private, no-store`.

Set server environment variables using `.env.example`:

```dotenv
TURN_URLS=turn:relay.example.com:3478?transport=udp,turns:relay.example.com:5349?transport=tcp
TURN_SHARED_SECRET=replace-with-your-relay-shared-secret
```

Use a relay supporting coturn REST shared-secret credentials and configure the
same secret there. The endpoint issues a random username prefixed with a one-hour
expiry and an HMAC-SHA1 password. Only temporary credentials reach the browser.
Credentials are bearer capabilities valid until expiry, not bound by the relay to
a particular room. See [coturn's authentication documentation](https://github.com/coturn/coturn/wiki/turnserver).

With neither variable set, local STUN behavior remains available. Partial/invalid
TURN configuration fails call setup instead of silently bypassing the relay.
Set `WEBRTC_RELAY_ONLY=true` temporarily on a test deployment to force relay
candidates. Use two distinct networks, confirm bidirectional audio/video and a
selected `relay` candidate in browser WebRTC diagnostics, then test reload and
room exit. Restore the default policy afterward unless relay-only is intended.
One-hour credentials cover the current short debates; longer future sessions
would require credential refresh. A real relay and these network checks remain open.

## Pilot release gates

### Invitation access

Set `PILOT_ACCESS_MODE=invite-only` on the web deployment, with
`PILOT_ACCOUNT_IDS` containing comma-separated Supabase Auth user UUIDs selected
by the owner. These are server-only settings. Obtain IDs from Supabase's Auth
user list; do not use email addresses, guest IDs, or browser-provided IDs.
An empty list closes participation to everyone; an unrecognized mode returns
503. Omitted mode (or `open`) preserves local guest access. Explicitly configure
the mode before pilot publication; the default is not invite-only.

The shared server authentication check verifies bearer tokens with Supabase
before checking permanent account IDs. Guests, anonymous Supabase accounts,
and unlisted accounts receive 403 on protected APIs, including queue, media
signalling, transcripts, judging, profiles, and history. Session initialization
and account status remain accessible so people can sign in or switch accounts.
Public pages and Supabase signup remain available; creating an account does not
grant participation. This gate does not restrict direct Supabase signup or
replace infrastructure rate limits. Removing an ID revokes subsequent protected
requests after the environment change is deployed. Finish ongoing debates before
changing the list: removal also blocks further room actions and history access.

November 13 local verification: 78 Node tests passed, ten PostgreSQL cases
skipped without a dedicated test database; lint and the production build passed.
Production-server HTTP checks rejected uninvited requests on twelve protected
endpoints, including a valid guest cookie, while keeping session/account/sign-in
access available. The pure policy tests cover invited IDs, anonymous accounts,
revocation, empty lists, and invalid modes. An invited real-account hosted flow
still needs verification after deployment. No deployed allowlist was changed.

- Real Supabase account flow and production SQL ownership/privacy checks pass.
- TURN works across separate networks; media-permission failures have usable fallback.
- Managed worker/AI restart and archive retry survive interruption.
- Measure simultaneous debate count, transcript latency, judging queue delay,
  and resource usage at the intended pilot size; set the invite cap from evidence.
- Enforce invitation access server-side before describing the deployment as invite-only.
- Configure HTTPS, backups with restore checks, and operational monitoring.

No public capacity claim or external deployment is complete. The invitation gate
is implemented locally and must be configured and verified on the pilot host.
Commit/push remains subject to the owner's checkpoint approval.
