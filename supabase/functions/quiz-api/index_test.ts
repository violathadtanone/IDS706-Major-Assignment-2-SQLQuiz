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
