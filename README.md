# IDS706-Major-Assignment-2-SQLQuiz

## School Lunch Data Lab

This static quiz site connects to Supabase for email-code authentication, saved
answers, and SQL execution. Signed-out users cannot run, check, or save queries.
Signed-in queries are parsed as one read-only `SELECT`, limited to the
`schools`, `students`, and `meals` tables and a small allowlist of safe
PostgreSQL built-in functions, then executed as the restricted `quiz_taker`
database role. PostgreSQL `$1`, `$2`, ... values are sent separately from SQL
text. The API writes run/save events to an append-only audit table; parameter
values are not recorded.

The Supabase project must be new or empty: the first migration creates and seeds
the dataset. Do not run `init.sql` against a shared database; it contains reset
statements. The migrations under `supabase/migrations/` are the deployment
source.

## Project Structure

```text
IDS706-Major-Assignment-2-SQLQuiz/
├── index.html                          # Quiz interface and sign-in dialog
├── style.css                           # Application styling and responsive layouts
├── app.js                              # Authentication, quiz interactions, scoring, and API calls
├── supabase-config.js                  # Browser-safe Supabase Project URL and publishable key
├── init.sql                            # Standalone database setup and seed script (contains resets)
├── query.py                            # Local Python database operations example
├── requirements.txt                    # Python dependencies
├── README.md                           # Project overview, setup, and testing instructions
├── .gitignore                          # Excludes local credentials and generated files
├── .github/
│   └── workflows/
│       └── test.yml                    # Hosted database verification using GitHub Secrets
├── supabase/
│   ├── config.toml                     # Supabase project and Edge Function configuration
│   ├── functions/
│   │   └── quiz-api/                   # Authenticated quiz backend, SQL guard, and backend tests
│   └── migrations/                    # Dataset, restricted roles, saved answers, and audit/login tables
└── tests/                             # Frontend behavior and live database permission tests
```
<br><br>

## GitHub Actions with GitHub Secrets

The **Verify hosted database** workflow runs on pushes to `main` or manually
from Actions. It uses one GitHub Secret to connect to the existing hosted
Supabase database with SSL and verifies that `public.students` is accessible
and contains data. A connection error, missing table, or empty table fails the
run. It does not apply migrations or deploy Supabase or the website.

1. In Supabase's **Connect** panel, select **Session pooler** (port `5432`).
   Use the same database connection details as your local `.env`:
   `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DB_HOST`, `DB_PORT`, and `POSTGRES_DB`.
2. Construct the PostgreSQL connection string in this format:

   ```text
   postgresql://<user>:<URL-encoded-password>@<session-pooler-host>:5432/<database>?sslmode=require
   ```

   Use the exact pooler username from Supabase, including the project suffix.
   URL-encode special characters in the password. This is a database connection
   string, not the browser/API URL ending in `.supabase.co`.
3. In GitHub, open **Settings → Secrets and variables → Actions → New repository
   secret**. Name it `DATABASE_URL` and paste the connection string as its value.
   Keep the actual credentials out of committed files. `.env` is ignored by Git;
   GitHub Actions does not automatically read your local `.env`.
4. Open **Actions → Verify hosted database → Run workflow**, or push to `main`.
   A successful run with the verification message demonstrates use of the secret.

## GitHub Pages and existing Supabase setup

Database verification is independent of GitHub Pages. This workflow does not
publish the frontend or change the existing hosted website. Keep Pages publishing
separate using your repository's Pages settings or a dedicated Pages workflow.
The previous combined Supabase/Pages deployment job has been removed.

Keep your existing Supabase Auth settings, deployed Edge Function and its
`QUIZ_DATABASE_URL` secret, and database schema. The new GitHub `DATABASE_URL`
secret is only for verification and does not replace the Edge Function's secret.
The browser still needs its existing public Supabase URL and publishable/anon
key in `supabase-config.js` when published. Any Pages publishing setup must
preserve those public values.
Never include database credentials in frontend files.

## Email-code sign-in and login transactions

Users request a code, read their email on any device, and enter the code in the
original quiz page. Successful verification records the login through the trusted
backend, then unlocks that browser, closes the dialog, and loads saved queries.
Invalid or expired codes keep the dialog
open; users can retry or resend (subject to Supabase's email rate limit).

One row in `public.login_transactions` records each successful quiz-app
email-code login: `user_id`, `logged_in_at` (database timestamp),
`authentication_method` (`email_otp`), and `session_id` (unique session identifier).
The existing `quiz-api` verifies the bearer token with Supabase Auth before
extracting its session ID. Only its server-side service client can insert or
read these records. Repeated requests for one session do not change its timestamp
or add rows. No codes or auth tokens are stored in this table. The quiz unlocks
only after login recording succeeds. If recording fails,
Supabase authentication remains valid, but the quiz stays locked with a clear
message; reloading retries the idempotent recording request. This table does not
replace Supabase's own audit logs or change `quiz_audit_log`.

Deploy these changes manually, keeping GitHub Actions as database verification:

1. Apply **only the reconciliation migration** to the existing hosted table,
   from the project root, after approving the deployment. It handles the hosted
   `login_at` / `auth_method` names and the original migration's canonical names,
   preserves existing records, enables RLS, removes client policies/grants, and
   permits only the service role to select/insert. It retains existing session
   uniqueness and enforces complete new records without rewriting legacy rows.
   If required columns are missing or both old/new names exist, it stops with
   an error rather than guessing or discarding data. It is safe to rerun.
   The prompt asks for your existing database administrator password:

   ```sh
   PGSSLMODE=require psql \
     -h aws-1-us-west-2.pooler.supabase.com -p 5432 \
     -U postgres.wfbucjgkxpzqxkckrxyr -d postgres -W -X \
     --single-transaction -v ON_ERROR_STOP=1 \
     -f supabase/migrations/20261020000003_reconcile_login_transactions.sql
   ```

   The existing hosted `login_transactions` table is required. Do not rerun
   its original CREATE TABLE migration, the dataset migration, or `init.sql`
   against your existing database. A fresh project still needs the original
   migrations first, followed by this reconciliation migration.
2. Deploy the updated function using the Supabase CLI:

   ```sh
   npx supabase login
   npx supabase functions deploy quiz-api --project-ref wfbucjgkxpzqxkckrxyr
   ```

   Keep its existing `QUIZ_DATABASE_URL` secret and JWT verification settings.
3. In **Supabase → Authentication → Email Templates**, update **Magic Link**
   and **Confirm signup** (for new users) to show the code instead of a link:

   ```html
   <h2>Your quiz sign-in code</h2>
   <p>Enter this code on the quiz page where you requested it:</p>
   <p><strong>{{ .Token }}</strong></p>
   ```

   Supabase uses the same `signInWithOtp` API for codes and magic links; the
   template determines the email content. See the official
   [email OTP instructions](https://supabase.com/docs/guides/auth/auth-email-passwordless#with-otp).
4. Publish the updated `index.html`, `app.js`, and `style.css` through your
   existing Pages publishing process. Test with an existing account and a new
   email: request on desktop, read on phone, and enter the code on desktop.
   Verify the dialog closes, the quiz unlocks, and one login row is recorded;
   reloading or refreshing the session should not add another row.

## Local checks

With Deno 2, Node.js 20, and PostgreSQL 16 installed:

```sh
node --check app.js
deno check supabase/functions/quiz-api/index.ts
deno test supabase/functions/quiz-api/index_test.ts
deno test supabase/functions/quiz-api/login-session_test.ts
deno test --allow-read=app.js tests/email-login_test.js
```

These optional local checks are separate from the hosted database workflow.

## Permission tests through the live quiz backend

The guard tests explicitly reject INSERT, UPDATE, DELETE, DROP, ALTER, CREATE,
TRUNCATE and GRANT, including each appended after an allowed SELECT. Guard
warnings are returned by `quiz-api` and shown by the existing Run Query error
message in the quiz. Redeploy `quiz-api` to publish updated warning text.

For live evidence, use `tests/quiz-permissions_live_test.ts`. It requires:

- `QUIZ_DATABASE_URL`: the **same quiz_runner Session Pooler connection** used
  by the Edge Function, with SSL required. Never use the administrator URL or
  the GitHub Actions `DATABASE_URL`. The test checks the real connection's
  session user is `quiz_runner` before attempting any permission probes.
- `QUIZ_TEST_ACCESS_TOKEN`: a current access token from an email-code sign-in
  to a **disposable quiz test account** in the same project. In the signed-in
  quiz's browser developer console, Chrome's `copy` helper can copy it without
  printing it: `copy((await client.auth.getSession()).data.session.access_token)`.
  Keep this token private; it is a temporary login credential, not an API key.

From the project root, enter the two values privately in your terminal (these
commands work in Bash or Zsh), then run the test:

```sh
printf 'Restricted quiz_runner connection URL: '
read -r -s QUIZ_DATABASE_URL
printf '\nSigned-in test account access token: '
read -r -s QUIZ_TEST_ACCESS_TOKEN
printf '\n'
export QUIZ_DATABASE_URL QUIZ_TEST_ACCESS_TOKEN
deno test --allow-env --allow-read=supabase-config.js --allow-net tests/quiz-permissions_live_test.ts
unset QUIZ_DATABASE_URL QUIZ_TEST_ACCESS_TOKEN
```

`--allow-env` is needed by the PostgreSQL driver for its `PG*` environment
settings as well as the two explicit test credentials; restricting it to only
those two names prevents the driver from initializing.

With either value missing the live test is **ignored**, not evidence of a
successful live permission check. Public Supabase settings are read from the
existing `supabase-config.js`; no new service-role key is needed.

The live test verifies SELECT returns rows through the deployed Edge Function,
each prohibited command and combined statement is rejected by its guard, and
PostgreSQL itself denies writes/schema changes when the guard is bypassed.
Direct role probes use read-write transactions to demonstrate missing privileges
independently of read-only transaction enforcement. Every direct probe always
rolls back, including if a prohibited operation unexpectedly succeeds. DML probes
also use an always-false row condition. Dataset fingerprints before/after verify
that seeded schools, students and meals have not changed.

The test separately exercises the existing trusted save/load and login endpoints.
Successful query responses require the backend audit write, and successful saves
require the existing atomic save/audit function. The restricted role is also
tested for denial of direct writes to progress, audit and login tables and denial
of the trusted save function. No permissions are granted for testing.

These trusted API operations intentionally leave normal audit/login records.
An existing top-students saved answer is preserved; if none exists, the test
saves its sample query on the disposable account. Other questions and seeded
data are not changed. This test does not deploy anything or change GitHub Actions.


## Final manual acceptance checks

After the migration, Edge Function redeployment, and frontend publication:

- Request an OTP on desktop, read it on a phone, and enter it on desktop. Verify
  one row with the correct user, server timestamp, `email_otp` and session ID;
  the dialog closes and the quiz unlocks only after the backend records it.
  Reload/focus/refresh the session: the same session has one row and its original
  timestamp. Sign out and sign in: the new session gets its own row.
- Type an unsaved query and parameters, then switch tabs away/back or refresh
  the Auth session: the draft and current results remain. Page reload may reset
  an unsaved draft; session refresh must not.
- With network throttling, save Question 1 and switch to Question 2 before the
  response. Question 1's saved query restores under Question 1 only. Repeat for
  Run Query: late results/errors from Question 1 never appear under Question 2.
- Signed out, direct Run/Save API calls fail. Signed in, SELECT returns live rows
  and a saved answer restores after reload. Complete all five questions for
  exactly 20 points; repeated checks add no points. Each hint retains SQL
  guidance (no complete solution query) and the expected output table.
- Run the opt-in live permission test with the actual `quiz_runner` connection
  and a disposable signed-in account. Verify guard rejection, PostgreSQL denial
  with the guard bypassed, unchanged seed data, and successful trusted saves,
  query/save auditing and idempotent login recording. Client/quiz roles must
  lack direct INSERT/UPDATE/DELETE/TRUNCATE on login history and modification
  access to quiz audit history.
- Verify a backend/audit outage produces a controlled JSON/CORS error in the
  existing feedback area; queries never report success if their audit write
  fails. Check GitHub Actions still verifies the database using `DATABASE_URL`;
  it does not deploy the app. Keep real credentials in Secrets/local `.env`.
