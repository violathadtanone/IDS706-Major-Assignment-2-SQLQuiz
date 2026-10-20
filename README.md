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

## Supabase and GitHub setup

1. Create a Supabase project and note its project reference, project URL, and
   publishable key (or legacy anon key). The public key will be included in the
   browser bundle. Never use a service-role key as the browser key.
2. In the repository's **Settings → Secrets and variables → Actions**, add:

   | Secret | Value |
   | --- | --- |
   | `SUPABASE_ACCESS_TOKEN` | A Supabase personal access token for deployment |
   | `SUPABASE_PROJECT_REF` | The Supabase project reference |
   | `SUPABASE_DB_PASSWORD` | The project's database password |
   | `SUPABASE_URL` | The project's URL, such as `https://<ref>.supabase.co` |
   | `SUPABASE_ANON_KEY` | The publishable key or legacy anon key |
   | `QUIZ_DATABASE_URL` | Add after the first migration, as described below |

   The publishable/anon key is intentionally public in the deployed site; it is
   kept in Actions Secrets to configure the build consistently. Do not add
   `SUPABASE_SERVICE_ROLE_KEY` or a database-owner connection string to the
   frontend.
3. Enable **Settings → Pages → Build and deployment → Source: GitHub Actions**.
   Configure Supabase Auth's site URL and allowed redirect URLs to include the
   exact GitHub Pages URL for this repository (and a local development URL if
   needed). The email template should use Supabase's standard magic-link
   confirmation.
4. Push to `main` or manually run **Quiz application checks and deployment**.
   CI checks JavaScript, type-checks and tests the Edge Function, applies both
   migrations to a temporary PostgreSQL instance, and verifies row counts,
   query-role access, and audit immutability. Deployment applies the migrations
   to Supabase first. On the first deployment it stops after migrations until
   the restricted database login is configured.
5. In the Supabase SQL Editor, set a unique password for the role created by the
   migration:

   ```sql
   ALTER ROLE quiz_runner WITH PASSWORD 'use-a-new-strong-password';
   ```

   Enter the password only in the SQL Editor; do not commit it. In Supabase's
   **Connect** panel, use the **Session pooler** connection details and
   `quiz_runner.<project-ref>` as the username. URL-encode special characters
   in the password and add `sslmode=require`. Save the resulting connection URL
   as the `QUIZ_DATABASE_URL` Actions secret. This connection is used only by
   the Edge Function; the role is a member of the read-only `quiz_taker` role.
6. Rerun the workflow. It will set the Edge Function secret, deploy `quiz-api`,
   build the browser configuration from the public URL/key, and publish the
   site to GitHub Pages.

The first deployment requires two workflow runs because the database role is
created by the migration before its password can be set. A green **checks** job
validates CI, but only a successful **deploy** job confirms the configured
Supabase and Pages deployment. Inspect Actions after pushing; no deployment is
claimed until that job succeeds.

## Local checks

With Deno 2, Node.js 20, and PostgreSQL 16 installed:

```sh
node --check app.js
deno check supabase/functions/quiz-api/index.ts
deno test supabase/functions/quiz-api/index_test.ts
```

The GitHub Actions workflow runs the database migration and privilege checks
against a disposable PostgreSQL 16 service.