import { createClient, type User } from "npm:@supabase/supabase-js@2.118.0";
import postgres from "npm:postgres@3.4.5";
import {
  guardReadOnlyQuery,
  SqlGuardError,
  type SqlParameter,
} from "./sql-guard.ts";

const allowedQuestions = new Set([
  "top-students",
  "average-gpa",
  "student-count",
  "city-cost",
  "school-cost",
]);
const maximumBodyBytes = 64_000;
const maximumRows = 500;
const maximumColumns = 40;
const maximumQueryBytes = 12_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

interface QuizRequest {
  action?: unknown;
  questionId?: unknown;
  query?: unknown;
  parameters?: unknown;
}

interface RunAudit {
  actor_id: string;
  action: "query_run";
  question_id: string;
  query_text: string;
  parameter_count: number;
  outcome: "success" | "rejected" | "error";
  row_count?: number;
}

class RequestBodyTooLargeError extends Error {}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function getRequiredEnvironment(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(
      `Required Supabase function environment variable ${name} is missing.`,
    );
  }
  return value;
}

function validateQuestionId(value: unknown): string {
  if (typeof value !== "string" || !allowedQuestions.has(value)) {
    throw new Error("Choose one of the available quiz questions.");
  }
  return value;
}

function validateQueryText(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Enter a SQL query first.");
  }
  if (new TextEncoder().encode(value).length > maximumQueryBytes) {
    throw new Error("The query is too long.");
  }
  return value;
}

function validateParameters(value: unknown): SqlParameter[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error("Parameters must be an array with no more than 20 values.");
  }
  for (const parameter of value) {
    if (
      parameter !== null &&
      typeof parameter !== "string" &&
      typeof parameter !== "boolean" &&
      !(typeof parameter === "number" && Number.isFinite(parameter))
    ) {
      throw new Error(
        "Parameters must be strings, finite numbers, booleans, or null.",
      );
    }
    if (
      typeof parameter === "string" &&
      new TextEncoder().encode(parameter).length > 2_000
    ) {
      throw new Error("A query parameter is too long.");
    }
  }
  return value as SqlParameter[];
}

function getUserClient() {
  return createClient(
    getRequiredEnvironment("SUPABASE_URL"),
    getRequiredEnvironment("SUPABASE_ANON_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function getServiceClient() {
  return createClient(
    getRequiredEnvironment("SUPABASE_URL"),
    getRequiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function readRequestBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) {
    return "";
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maximumBodyBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function getAuthenticatedUser(request: Request): Promise<User | null> {
  const authorization = request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    return null;
  }

  const { data, error } = await getUserClient().auth.getUser(token);
  if (error || !data.user) {
    return null;
  }
  return data.user;
}

async function insertRunAudit(entry: RunAudit): Promise<void> {
  const { error } = await getServiceClient().from("quiz_audit_log").insert(
    entry,
  );
  if (error) {
    console.error("Could not append quiz audit record.", error.code);
    throw new Error(
      "The audit log is unavailable; the query result was not returned.",
    );
  }
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Uint8Array) {
    return `[binary value, ${value.byteLength} bytes]`;
  }
  if (typeof value === "string" && value.length > 8_000) {
    return `${value.slice(0, 8_000)}…`;
  }
  return value;
}

async function executeReadOnlyQuery(
  query: string,
  parameters: SqlParameter[],
): Promise<{ columns: string[]; rows: unknown[][]; truncated: boolean }> {
  const databaseUrl = getRequiredEnvironment("QUIZ_DATABASE_URL");
  const database = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 10,
    connect_timeout: 10,
    ssl: "require",
    prepare: false,
  });

  try {
    return await database.begin("read only", async (transaction) => {
      await transaction.unsafe("SET LOCAL ROLE quiz_taker");
      await transaction.unsafe("SET LOCAL search_path = pg_catalog, public");
      await transaction.unsafe("SET LOCAL statement_timeout = '5000ms'");
      await transaction.unsafe("SET LOCAL lock_timeout = '1000ms'");

      const boundedQuery = `SELECT * FROM (${query}) AS quiz_result LIMIT ${
        maximumRows + 1
      }`;
      const result = await transaction.unsafe(boundedQuery, parameters);
      const columns = result.columns.map((column) => column.name);
      if (columns.length > maximumColumns) {
        throw new Error("The query returned too many columns.");
      }

      return {
        columns,
        rows: result
          .slice(0, maximumRows)
          .map((row) => columns.map((column) => normalizeValue(row[column]))),
        truncated: result.length > maximumRows,
      };
    });
  } finally {
    await database.end({ timeout: 1 });
  }
}

async function handleLoad(user: User): Promise<Response> {
  const { data, error } = await getServiceClient()
    .from("quiz_progress")
    .select("question_id, query_text, parameters, saved_at")
    .eq("user_id", user.id)
    .order("saved_at", { ascending: false });

  if (error) {
    console.error("Could not load saved quiz progress.", error.code);
    return response(500, { error: "Saved quiz progress could not be loaded." });
  }
  return response(200, { progress: data });
}

async function handleSave(user: User, body: QuizRequest): Promise<Response> {
  let questionId: string;
  let query: string;
  let parameters: SqlParameter[];
  try {
    questionId = validateQuestionId(body.questionId);
    query = validateQueryText(body.query);
    parameters = validateParameters(body.parameters ?? []);
  } catch (error) {
    return response(400, {
      error: error instanceof Error
        ? error.message
        : "Invalid quiz submission.",
    });
  }

  const { data, error } = await getServiceClient().rpc("save_quiz_answer", {
    p_actor_id: user.id,
    p_question_id: questionId,
    p_query_text: query,
    p_parameters: parameters,
  });
  if (error) {
    console.error("Could not save quiz progress.", error.code);
    return response(500, { error: "The quiz could not be saved." });
  }
  return response(200, { progress: data });
}

async function handleRun(user: User, body: QuizRequest): Promise<Response> {
  let questionId: string;
  let query: string;
  let parameters: SqlParameter[];
  try {
    questionId = validateQuestionId(body.questionId);
    query = validateQueryText(body.query);
    parameters = validateParameters(body.parameters ?? []);
  } catch (error) {
    return response(400, {
      error: error instanceof Error ? error.message : "Invalid query request.",
    });
  }

  let result: { columns: string[]; rows: unknown[][]; truncated: boolean };
  try {
    const guarded = guardReadOnlyQuery(query, parameters);
    result = await executeReadOnlyQuery(
      guarded.normalizedSql,
      guarded.parameters,
    );
  } catch (error) {
    const isRejected = error instanceof SqlGuardError;
    await insertRunAudit({
      actor_id: user.id,
      action: "query_run",
      question_id: questionId,
      query_text: query,
      parameter_count: parameters.length,
      outcome: isRejected ? "rejected" : "error",
    });

    if (isRejected) {
      return response(400, { error: error.message });
    }
    console.error(
      "Quiz query execution failed.",
      error instanceof Error ? error.name : "unknown",
    );
    return response(400, {
      error:
        "The database could not run this query. Check the SQL and parameter placeholders.",
    });
  }

  await insertRunAudit({
    actor_id: user.id,
    action: "query_run",
    question_id: questionId,
    query_text: query,
    parameter_count: parameters.length,
    outcome: "success",
    row_count: result.rows.length,
  });
  return response(200, result);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return response(405, { error: "Use POST for quiz API requests." });
  }

  let body: QuizRequest;
  try {
    const rawBody = await readRequestBody(request);
    const parsedBody: unknown = JSON.parse(rawBody);
    if (
      parsedBody === null ||
      typeof parsedBody !== "object" ||
      Array.isArray(parsedBody)
    ) {
      return response(400, {
        error: "The request body must be a JSON object.",
      });
    }
    body = parsedBody;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return response(413, { error: "The request body is too large." });
    }
    return response(400, { error: "The request body must be valid JSON." });
  }

  let user: User | null;
  try {
    user = await getAuthenticatedUser(request);
  } catch (error) {
    console.error(
      "Supabase Auth verification failed.",
      error instanceof Error ? error.name : "unknown",
    );
    return response(503, { error: "Authentication could not be verified." });
  }
  if (!user) {
    return response(401, { error: "Sign in before using the quiz backend." });
  }

  if (body.action === "load") {
    return handleLoad(user);
  }
  if (body.action === "save") {
    return handleSave(user, body);
  }
  if (body.action === "run") {
    return handleRun(user, body);
  }
  return response(400, { error: "Choose a supported quiz action." });
});
