import postgres from "npm:postgres@3.4.5";

// Opt-in: no admin/service key or admin database connection is accepted.
const databaseUrl = Deno.env.get("QUIZ_DATABASE_URL");
const accessToken = Deno.env.get("QUIZ_TEST_ACCESS_TOKEN");
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test({
  name:
    "LIVE quiz API and quiz_runner defense in depth (requires restricted URL + signed-in token)",
  ignore: !databaseUrl || !accessToken,
  async fn(t) {
    assert(databaseUrl && accessToken, "Provide both live-test credentials");
    const username = decodeURIComponent(new URL(databaseUrl).username);
    assert(
      /^quiz_runner(?:\.[a-z0-9]+)?$/.test(username),
      "Use the quiz_runner connection, never postgres/admin",
    );
    const configSource = await Deno.readTextFile("supabase-config.js");
    const config = new Function(
      "window",
      configSource + ";return window.SUPABASE_CONFIG;",
    )({});
    assert(
      config.url?.startsWith("https://") && config.anonKey,
      "Configure the public frontend URL/key",
    );
    const ref = new URL(config.url).hostname.split(".")[0];
    if (username.includes(".")) {
      assert(
        username === `quiz_runner.${ref}`,
        "Database and frontend must use the same project",
      );
    }

    const database = postgres(databaseUrl, {
      max: 1,
      ssl: "require",
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 1,
      onnotice: () => {},
    });
    const tables = {
      schools: "school_id",
      students: "student_id",
      meals: "meal_id",
    };
    const query =
      "SELECT student_id, first_name, gpa FROM students ORDER BY gpa DESC LIMIT 3";
    const writes = {
      INSERT: "INSERT INTO students SELECT * FROM students WHERE false",
      UPDATE: "UPDATE students SET gpa = gpa WHERE false",
      DELETE: "DELETE FROM students WHERE false",
      DROP: "DROP TABLE public.quiz_permission_probe_nonexistent",
      ALTER: "ALTER TABLE students ADD COLUMN quiz_permission_probe integer",
      CREATE: "CREATE TABLE public.quiz_permission_probe (id integer)",
      TRUNCATE: "TRUNCATE TABLE meals",
      GRANT: "GRANT INSERT ON students TO quiz_taker",
    };
    async function api(body: Record<string, unknown>) {
      const response = await fetch(`${config.url}/functions/v1/quiz-api`, {
        method: "POST",
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }
    async function rollbackProbe(
      mode: "read only" | "read write",
      probe: (sql: postgres.TransactionSql) => Promise<void>,
    ) {
      const rollback = new Error("Intentional test rollback");
      try {
        await database.begin(mode, async (sql) => {
          await sql.unsafe("SET LOCAL ROLE quiz_taker");
          await sql.unsafe("SET LOCAL statement_timeout = '5000ms'");
          await sql.unsafe("SET LOCAL lock_timeout = '1000ms'");
          await probe(sql);
          throw rollback; // Also roll back if an unexpectedly permitted operation succeeded.
        });
      } catch (error) {
        if (error !== rollback) throw error;
      }
    }
    async function snapshot() {
      const hashes: string[] = [];
      await rollbackProbe("read only", async (sql) => {
        for (const [table, key] of Object.entries(tables)) {
          const rows = await sql.unsafe(
            `SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY ${key})::text, '[]')) AS digest FROM public.${table} t`,
          );
          hashes.push(rows[0].digest);
        }
      });
      return JSON.stringify(hashes);
    }
    try {
      const identity = await database.unsafe(
        "SELECT current_user AS active_role, session_user AS login_role, rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user",
      );
      assert(
        identity[0].active_role === "quiz_runner" &&
          identity[0].login_role === "quiz_runner",
        "Must actually connect as quiz_runner",
      );
      assert(
        !identity[0].rolsuper && !identity[0].rolcreaterole &&
          !identity[0].rolcreatedb,
        "Runner must not have elevated role attributes",
      );
      const before = await snapshot();

      const selectPassed = await t.step(
        "signed-in deployed quiz-api SELECT returns live rows",
        async () => {
          const result = await api({
            action: "run",
            questionId: "top-students",
            query,
            parameters: [],
          });
          assert(
            result.status === 200,
            "Live SELECT failed; check session, deployment, restricted URL and audit configuration",
          );
          assert(
            result.body.rows?.length > 0 &&
              result.body.columns?.includes("student_id"),
            "Expected live student rows",
          );
          // handleRun returns success only after the trusted audit INSERT succeeds.
        },
      );
      assert(
        selectPassed,
        "Stop before further live probes if the authenticated path is not working",
      );

      for (const [command, sql] of Object.entries(writes)) {
        for (const combined of [false, true]) {
          await t.step(
            `deployed API rejects ${
              combined ? "SELECT + " : ""
            }${command} before SQL execution`,
            async () => {
              const result = await api({
                action: "run",
                questionId: "top-students",
                query: combined ? `${query}; ${sql}` : sql,
                parameters: [],
              });
              assert(
                result.status === 400,
                "Expected guard rejection (and a successful rejection-audit write)",
              );
              assert(
                /not allowed|one .*statement|one SQL statement|parser could not understand|only read-only SELECT/i
                  .test(result.body.error ?? ""),
                "Expected the SQL guard's warning, not a database execution error",
              );
            },
          );
        }
      }

      await t.step(
        "actual execution role reads rows inside a read-only transaction",
        async () => {
          await rollbackProbe("read only", async (sql) => {
            const identity = await sql.unsafe(
              "SELECT current_user AS role, session_user AS login, current_setting('transaction_read_only') AS read_only",
            );
            assert(
              identity[0].role === "quiz_taker" &&
                identity[0].login === "quiz_runner" &&
                identity[0].read_only === "on",
              "Wrong quiz database context",
            );
            assert(
              (await sql.unsafe(query)).length > 0,
              "Restricted SELECT returned no rows",
            );
          });
        },
      );

      const probeName = `quiz_permission_${
        crypto.randomUUID().replaceAll("-", "")
      }`;
      const databaseWrites: Record<string, string> = {};
      for (const table of Object.keys(tables)) {
        // No rows can be changed even if a DML permission is unexpectedly present.
        databaseWrites[`INSERT ${table}`] =
          `INSERT INTO public.${table} SELECT * FROM public.${table} WHERE false`;
        databaseWrites[`UPDATE ${table}`] = `UPDATE public.${table} SET ${
          tables[table as keyof typeof tables]
        } = ${tables[table as keyof typeof tables]} WHERE false`;
        databaseWrites[`DELETE ${table}`] =
          `DELETE FROM public.${table} WHERE false`;
        databaseWrites[`ALTER ${table}`] =
          `ALTER TABLE public.${table} ADD COLUMN ${probeName} integer`;
        databaseWrites[`DROP ${table}`] = `DROP TABLE public.${table} CASCADE`;
        databaseWrites[`TRUNCATE ${table}`] =
          `TRUNCATE TABLE public.${table} CASCADE`;
      }
      databaseWrites.CREATE = `CREATE TABLE public.${probeName} (id integer)`;
      databaseWrites.GRANT = "GRANT quiz_taker TO anon";
      databaseWrites["trusted save RPC"] =
        "SELECT public.save_quiz_answer('00000000-0000-0000-0000-000000000001','top-students','SELECT student_id FROM students','[]'::jsonb)";
      for (
        const table of ["quiz_progress", "quiz_audit_log", "login_transactions"]
      ) {
        databaseWrites[`direct ${table} INSERT`] =
          `INSERT INTO public.${table} DEFAULT VALUES`;
      }
      for (const [command, sql] of Object.entries(databaseWrites)) {
        await t.step(
          `database denies ${command} with the guard bypassed and read-only mode OFF`,
          async () => {
            // Test privileges independently of both the parser and read-only mode.
            await rollbackProbe("read write", async (transaction) => {
              let denied = false;
              try {
                await transaction.unsafe(sql);
              } catch (error) {
                denied = (error as { code?: string }).code === "42501";
              }
              assert(
                denied,
                `${command}: expected PostgreSQL insufficient_privilege (42501)`,
              );
            });
          },
        );
      }

      await t.step(
        "trusted backend can still save/load answers and append the save audit",
        async () => {
          const loaded = await api({ action: "load" });
          assert(
            loaded.status === 200 && Array.isArray(loaded.body.progress),
            "Could not load saved answers",
          );
          const original = loaded.body.progress.find((
            entry: { question_id: string },
          ) => entry.question_id === "top-students");
          // Preserve an existing answer; otherwise create one on the disposable test account.
          const text = original?.query_text ?? query;
          const parameters = original?.parameters ?? [];
          const saved = await api({
            action: "save",
            questionId: "top-students",
            query: text,
            parameters,
          });
          assert(
            saved.status === 200 && saved.body.progress?.query_text === text,
            "Trusted save/audit transaction failed",
          );
          const reloaded = await api({ action: "load" });
          assert(
            reloaded.status === 200 &&
              reloaded.body.progress.some((
                entry: { question_id: string; query_text: string },
              ) =>
                entry.question_id === "top-students" &&
                entry.query_text === text
              ),
            "Saved query did not persist",
          );
        },
      );
      await t.step(
        "trusted backend can still record the verified email-code login",
        async () => {
          for (let attempt = 0; attempt < 2; attempt++) {
            const result = await api({ action: "login" });
            assert(
              result.status === 200 && result.body.recorded === true,
              "Trusted idempotent login write failed",
            );
          }
        },
      );
      await t.step("seeded schools/students/meals are unchanged", async () => {
        assert(
          await snapshot() === before,
          "Seeded table contents changed during the tests",
        );
      });
    } finally {
      await database.end({ timeout: 1 });
    }
  },
});
