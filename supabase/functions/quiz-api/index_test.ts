import { guardReadOnlyQuery, SqlGuardError } from "./sql-guard.ts";

function assertThrows(action: () => unknown, message: string): void {
  try {
    action();
  } catch (error) {
    if (error instanceof SqlGuardError) {
      return;
    }
    throw error;
  }
  throw new Error(message);
}

Deno.test("accepts a select with separately bound parameters", () => {
  const query = guardReadOnlyQuery(
    "SELECT student_id FROM public.students WHERE grade_level = $1 AND gpa >= $2;",
    ["Grade 9", 3],
  );
  if (!query.normalizedSql.toLowerCase().includes("select")) {
    throw new Error("The normalized SQL should remain a SELECT.");
  }
  if (query.parameters[0] !== "Grade 9" || query.parameters[1] !== 3) {
    throw new Error("The values should be preserved separately from SQL.");
  }
});

Deno.test("keeps SQL-looking input in bound parameter values", () => {
  const value = "' OR 1=1 --";
  const query = guardReadOnlyQuery(
    "SELECT student_id FROM students WHERE last_name = $1",
    [value],
  );
  if (query.normalizedSql.includes(value) || query.parameters[0] !== value) {
    throw new Error("Parameter data must stay separate from normalized SQL.");
  }
});

Deno.test("accepts a quiz aggregation over the permitted dataset", () => {
  guardReadOnlyQuery(
    `SELECT s.city, ROUND(AVG(m.price), 2)
     FROM schools s
     JOIN students st ON st.school_id = s.school_id
     JOIN meals m ON m.student_id = st.student_id
     GROUP BY s.city`,
    [],
  );
});

Deno.test("existing guard accepts alternate read-only structures and repeated aliases", () => {
  for (const sql of [
    `select q.student_id as id, q.first_name as given_name, q.last_name as family_name,
       q.grade_level as grade, q.gpa as score
     from (select * from students) q order by q.gpa desc limit 10`,
    `SELECT s.school_name AS label,
       ROUND((SELECT AVG(st.gpa) FROM students st WHERE st.school_id = s.school_id), 2) AS score
     FROM schools s WHERE (SELECT COUNT(*) FROM students st WHERE st.school_id = s.school_id) > 0
     ORDER BY score DESC`,
    `SELECT student_id AS repeated, first_name AS repeated FROM students`,
  ]) {
    guardReadOnlyQuery(sql, []);
  }
});

Deno.test("rejects writes and multiple statements", () => {
  assertThrows(
    () => guardReadOnlyQuery("DELETE FROM students", []),
    "DELETE should be rejected.",
  );
  assertThrows(
    () => guardReadOnlyQuery("SELECT * FROM students; SELECT * FROM meals", []),
    "Multiple statements should be rejected.",
  );
  assertThrows(
    () => guardReadOnlyQuery("SELECT * INTO new_table FROM students", []),
    "SELECT INTO should be rejected.",
  );
});

const prohibitedStatements = {
  INSERT: "INSERT INTO students SELECT * FROM students WHERE false",
  UPDATE: "UPDATE students SET gpa = gpa WHERE false",
  DELETE: "DELETE FROM students WHERE false",
  DROP: "DROP TABLE meals",
  ALTER: "ALTER TABLE students ADD COLUMN quiz_permission_probe integer",
  CREATE: "CREATE TABLE public.quiz_permission_probe (id integer)",
  TRUNCATE: "TRUNCATE TABLE meals",
  GRANT: "GRANT INSERT ON students TO quiz_taker",
};

for (const [command, sql] of Object.entries(prohibitedStatements)) {
  Deno.test(`guard rejects ${command} and warns the quiz user`, () => {
    try {
      guardReadOnlyQuery(sql, []);
    } catch (error) {
      if (
        error instanceof SqlGuardError && /not allowed/i.test(error.message)
      ) return;
      throw error;
    }
    throw new Error(`${command} was accepted`);
  });
  Deno.test(`guard rejects SELECT followed by ${command}`, () => {
    assertThrows(
      () => guardReadOnlyQuery(`SELECT student_id FROM students; ${sql}`, []),
      `SELECT followed by ${command} should be rejected.`,
    );
  });
}

Deno.test("rejects tables, schemas, and functions outside the quiz surface", () => {
  assertThrows(
    () => guardReadOnlyQuery("SELECT * FROM auth.users", []),
    "Auth data should not be queryable.",
  );
  assertThrows(
    () => guardReadOnlyQuery("SELECT * FROM public.quiz_audit_log", []),
    "Audit data should not be queryable.",
  );
  assertThrows(
    () => guardReadOnlyQuery("SELECT pg_sleep(10) FROM students", []),
    "Untrusted PostgreSQL functions should be rejected.",
  );
  assertThrows(
    () =>
      guardReadOnlyQuery(
        "SELECT query_to_xml('SELECT 1', true, false, '') FROM students",
        [],
      ),
    "Functions that execute nested SQL should be rejected.",
  );
  assertThrows(
    () =>
      guardReadOnlyQuery(
        "SELECT extensions.http_get('https://example.com') FROM students",
        [],
      ),
    "Schema-qualified extension functions should be rejected.",
  );
});

Deno.test("requires exact, scalar query parameters", () => {
  assertThrows(
    () => guardReadOnlyQuery("SELECT * FROM students WHERE gpa > $1", []),
    "Missing parameters should be rejected.",
  );
  assertThrows(
    () => guardReadOnlyQuery("SELECT * FROM students WHERE gpa > $1", [3, 4]),
    "Unused parameters should be rejected.",
  );
  assertThrows(
    () =>
      guardReadOnlyQuery("SELECT * FROM students WHERE gpa > $1", [{
        value: 3,
      }]),
    "Object parameters should be rejected.",
  );
});

Deno.test("rejects row locks and table-valued functions", () => {
  assertThrows(
    () => guardReadOnlyQuery("SELECT * FROM students FOR UPDATE", []),
    "Row locks should be rejected.",
  );
  assertThrows(
    () => guardReadOnlyQuery("SELECT * FROM generate_series(1, 5)", []),
    "Table-valued functions should be rejected.",
  );
});

Deno.test("backend service and audit failures return controlled JSON/CORS errors", async (t) => {
  let handler: (request: Request) => Promise<Response>;
  const originalServe = Deno.serve;
  const originalFetch = globalThis.fetch;
  const originalGet = Deno.env.get;
  let mode = "audit-error";
  let audits = 0;
  const user = {
    id: "00000000-0000-0000-0000-000000000001",
    email: "student@example.test",
    aud: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-10-20T00:00:00Z",
  };
  try {
    // Capture the actual Edge Function callback without binding a test server.
    Deno.serve = ((callback: (request: Request) => Promise<Response>) => {
      handler = callback;
      return {};
    }) as typeof Deno.serve;
    const { serializeQueryResult } = await import("./index.ts");
    Deno.serve = originalServe;
    await t.step("positional serialization preserves distinct cells with repeated aliases", () => {
      const result = serializeQueryResult(["same", "same", "same", "same"], [
        ["student_074", "Lucas", 3.97, null],
        ["student_081", "Henry", 3.92, null],
      ]);
      if (JSON.stringify(result) !== JSON.stringify({
        columns: ["same", "same", "same", "same"],
        rows: [["student_074", "Lucas", 3.97, null], ["student_081", "Henry", 3.92, null]],
        truncated: false,
      })) throw new Error("Repeated aliases lost distinct positional values");
      const normalized = serializeQueryResult(["same", "same"], [[1n, new Date("2026-10-20T00:00:00Z")]]);
      if (normalized.rows[0][0] !== "1" || normalized.rows[0][1] !== "2026-10-20T00:00:00.000Z") {
        throw new Error("Positional serialization changed value normalization");
      }
    });
    await t.step("positional serialization preserves result bounds", () => {
      const result = serializeQueryResult(["value"], Array.from({ length: 501 }, (_, i) => [i]));
      if (!result.truncated || result.rows.length !== 500 || result.rows[499][0] !== 499) {
        throw new Error("Result row bounds changed");
      }
      let rejected = false;
      try { serializeQueryResult(Array(41).fill("same"), []); }
      catch { rejected = true; }
      if (!rejected) throw new Error("Column bound changed");
    });
    Deno.env.get = (name: string) => {
      if (mode === "missing-service" && name === "SUPABASE_SERVICE_ROLE_KEY") {
        return undefined;
      }
      return ({
        SUPABASE_URL: "https://quiz.example.test",
        SUPABASE_ANON_KEY: "public-test-key",
        SUPABASE_SERVICE_ROLE_KEY: "server-test-key",
      })[name as "SUPABASE_URL"];
    };
    globalThis.fetch = async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/auth/v1/user")) return Response.json(user);
      if (mode === "network-error") {
        throw new Error("private backend detail must not be exposed");
      }
      if (url.includes("/quiz_audit_log")) {
        audits++;
        return mode === "audit-ok"
          ? new Response(null, { status: 201 })
          : Response.json({
            code: "XX000",
            message: "private database details",
          }, { status: 500 });
      }
      return Response.json({
        code: "XX000",
        message: "private database details",
      }, { status: 500 });
    };
    const request = (action: string, authorized = true) =>
      new Request("https://quiz.example.test/functions/v1/quiz-api", {
        method: "POST",
        headers: authorized
          ? {
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          }
          : { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          questionId: "top-students",
          query: "DELETE FROM students WHERE false",
          parameters: [],
        }),
      });
    await t.step(
      "signed-out run/save calls are rejected before trusted operations",
      async () => {
        for (const action of ["run", "save"]) {
          const result = await handler(request(action, false));
          if (result.status !== 401) {
            throw new Error("Unsigned request accepted");
          }
          await result.json();
        }
        if (audits !== 0) {
          throw new Error("Signed-out request wrote audit history");
        }
      },
    );
    await t.step(
      "audit failure stays fail-closed and returns useful error",
      async () => {
        const result = await handler(request("run"));
        const body = await result.json();
        if (
          result.status !== 503 ||
          !body.error.includes("audit log is unavailable") ||
          result.headers.get("Access-Control-Allow-Origin") !== "*"
        ) {
          throw new Error("Audit error was not controlled");
        }
        if (body.rows || body.error.includes("private")) {
          throw new Error("Leaked results or internal details");
        }
      },
    );
    await t.step(
      "guard rejection still appends its audit when the service works",
      async () => {
        mode = "audit-ok";
        const before = audits;
        const result = await handler(request("run"));
        const body = await result.json();
        if (
          result.status !== 400 || !body.error.includes("not allowed") ||
          audits !== before + 1
        ) {
          throw new Error("Guard/audit behavior changed");
        }
      },
    );
    await t.step(
      "save and load network failures return controlled errors",
      async () => {
        mode = "network-error";
        for (const action of ["save", "load"]) {
          const result = await handler(request(action));
          const body = await result.json();
          if (
            ![500, 503].includes(result.status) ||
            typeof body.error !== "string" ||
            result.headers.get("Content-Type") !== "application/json" ||
            body.error.includes("private")
          ) {
            throw new Error("Service failure escaped controlled handling");
          }
        }
      },
    );
    await t.step(
      "unexpected service configuration failure is caught around awaited handlers",
      async () => {
        mode = "missing-service";
        const result = await handler(request("load"));
        const body = await result.json();
        if (
          result.status !== 503 ||
          !body.error.includes("temporarily unavailable") ||
          result.headers.get("Access-Control-Allow-Origin") !== "*"
        ) {
          throw new Error(
            "Rejected handler promise escaped controlled handling",
          );
        }
      },
    );
  } finally {
    Deno.serve = originalServe;
    globalThis.fetch = originalFetch;
    Deno.env.get = originalGet;
  }
});
