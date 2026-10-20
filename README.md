# IDS706-Major-Assignment-2-SQLQuiz

## School Lunch Data Lab

This static quiz site connects to Supabase for magic-link authentication, saved
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
key in `supabase-config.js` when published. The checked-in configuration is a
placeholder; any future Pages publishing setup must supply those public values.
Never include database credentials in frontend files.

## Local checks

With Deno 2, Node.js 20, and PostgreSQL 16 installed:

```sh
node --check app.js
deno check supabase/functions/quiz-api/index.ts
deno test supabase/functions/quiz-api/index_test.ts
```

These optional local checks are separate from the hosted database workflow.
