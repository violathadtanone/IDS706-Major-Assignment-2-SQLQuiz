import {
  astVisitor,
  type ExprCall,
  type ExprParameter,
  type FromCall,
  type FromTable,
  parse,
  toSql,
} from "npm:pgsql-ast-parser@12.0.2";

const allowedTables = new Set(["schools", "students", "meals"]);
const allowedFunctions = new Set([
  "abs",
  "avg",
  "ceil",
  "ceiling",
  "coalesce",
  "concat",
  "count",
  "date_part",
  "date_trunc",
  "greatest",
  "least",
  "length",
  "lower",
  "max",
  "min",
  "nullif",
  "round",
  "sum",
  "to_char",
  "upper",
]);
const maximumQueryBytes = 12_000;
const maximumParameters = 20;
const maximumParameterStringLength = 2_000;

export class SqlGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SqlGuardError";
  }
}

export type SqlParameter = string | number | boolean | null;

export interface GuardedQuery {
  normalizedSql: string;
  parameters: SqlParameter[];
}

function validateParameters(value: unknown): SqlParameter[] {
  if (!Array.isArray(value) || value.length > maximumParameters) {
    throw new SqlGuardError(
      "Parameters must be an array with no more than 20 values.",
    );
  }

  for (const parameter of value) {
    if (
      parameter !== null &&
      typeof parameter !== "string" &&
      typeof parameter !== "boolean" &&
      !(typeof parameter === "number" && Number.isFinite(parameter))
    ) {
      throw new SqlGuardError(
        "Parameters must be strings, finite numbers, booleans, or null.",
      );
    }
    if (
      typeof parameter === "string" &&
      new TextEncoder().encode(parameter).length > maximumParameterStringLength
    ) {
      throw new SqlGuardError("A query parameter is too long.");
    }
  }

  return value as SqlParameter[];
}

function rejectUnsafeSelectClauses(node: object): void {
  const seen = new Set<object>();
  const pending: object[] = [node];

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    for (const [key, value] of Object.entries(current)) {
      if (key === "into" && value !== undefined && value !== null) {
        throw new SqlGuardError("SELECT INTO is not allowed.");
      }
      if (
        (key === "for" || key === "skip") &&
        value !== undefined &&
        value !== null
      ) {
        throw new SqlGuardError("Row-locking clauses are not allowed.");
      }
      if (value && typeof value === "object") {
        if (Array.isArray(value)) {
          pending.push(
            ...value.filter((item): item is object =>
              Boolean(item) && typeof item === "object"
            ),
          );
        } else {
          pending.push(value);
        }
      }
    }
  }
}

export function guardReadOnlyQuery(
  sql: string,
  rawParameters: unknown,
): GuardedQuery {
  if (typeof sql !== "string" || sql.trim().length === 0) {
    throw new SqlGuardError("Enter a SQL query.");
  }
  if (new TextEncoder().encode(sql).length > maximumQueryBytes) {
    throw new SqlGuardError("The query is too long.");
  }

  const parameters = validateParameters(rawParameters);
  let statements;
  try {
    statements = parse(sql);
  } catch {
    throw new SqlGuardError("The SQL parser could not understand this query.");
  }
  if (statements.length !== 1) {
    throw new SqlGuardError("Run one SQL statement at a time.");
  }

  const statement = statements[0];
  if (
    statement.type !== "select" &&
    statement.type !== "union" &&
    statement.type !== "union all"
  ) {
    throw new SqlGuardError("Only read-only SELECT queries are allowed.");
  }

  rejectUnsafeSelectClauses(statement);
  const referencedTables = new Set<string>();
  const referencedParameters = new Set<number>();

  const visitor = astVisitor((map) => ({
    fromTable(table: FromTable) {
      const name = table.name.name.toLowerCase();
      const schema = table.name.schema?.toLowerCase();
      if ((schema && schema !== "public") || !allowedTables.has(name)) {
        throw new SqlGuardError(
          "Queries may only read the schools, students, and meals tables.",
        );
      }
      referencedTables.add(name);
      return map.super().fromTable(table);
    },
    fromCall(_table: FromCall) {
      throw new SqlGuardError("Table-valued functions are not allowed.");
    },
    call(call: ExprCall) {
      const name = call.function.name.toLowerCase();
      const schema = call.function.schema?.toLowerCase();
      if ((schema && schema !== "pg_catalog") || !allowedFunctions.has(name)) {
        throw new SqlGuardError(
          "Only approved built-in SQL functions are allowed.",
        );
      }
      return map.super().call(call);
    },
    parameter(parameter: ExprParameter) {
      const index = Number(parameter.name.replace(/^\$/, ""));
      if (!Number.isInteger(index) || index < 1 || index > maximumParameters) {
        throw new SqlGuardError(
          "Use numbered PostgreSQL parameters such as $1.",
        );
      }
      referencedParameters.add(index);
      return map.super().parameter(parameter);
    },
  }));

  try {
    visitor.statement(statement);
  } catch (error) {
    if (error instanceof SqlGuardError) {
      throw error;
    }
    throw new SqlGuardError("The query contains unsupported SQL.");
  }

  if (referencedTables.size === 0) {
    throw new SqlGuardError(
      "Query at least one table: schools, students, or meals.",
    );
  }

  const expectedParameters = new Set(
    Array.from({ length: parameters.length }, (_, index) => index + 1),
  );
  if (
    referencedParameters.size !== expectedParameters.size ||
    [...referencedParameters].some((index) => !expectedParameters.has(index))
  ) {
    throw new SqlGuardError(
      "Supply exactly one JSON parameter value for each placeholder, numbered $1 through $n.",
    );
  }

  return {
    normalizedSql: toSql.statement(statement),
    parameters,
  };
}
