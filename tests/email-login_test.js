// Exercise the real frontend handlers with a small DOM and Supabase stub.
const source = await Deno.readTextFile(new URL("../app.js", import.meta.url));
function assert(value, message) {
  if (!value) throw new Error(message);
}

function makeSession(
  user = "user-a",
  id = "00000000-0000-0000-0000-000000000001",
  refreshed = false,
) {
  const claims = {
    sub: user,
    session_id: id,
    amr: [{ method: "otp" }],
    exp: refreshed ? 200 : 100,
  };
  return {
    user: { id: user, email: `${user}@example.test` },
    access_token: `header.${btoa(JSON.stringify(claims))}.signature`,
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setup(
  { verificationError = null, loggingError = null, invokeHook = null } = {},
) {
  const nodes = new Map();
  function element() {
    return {
      value: "",
      disabled: false,
      hidden: false,
      open: false,
      style: {},
      classList: { toggle() {}, add() {}, remove() {} },
      attributes: {},
      children: [],
      setAttribute(key, value) {
        this.attributes[key] = value;
      },
      removeAttribute() {},
      replaceChildren(...children) {
        this.children = children;
      },
      append(...children) {
        this.children.push(...children);
      },
      listeners: {},
      addEventListener(name, callback) {
        this.listeners[name] = callback;
      },
      focus() {},
      close() {
        this.open = false;
      },
    };
  }
  const document = {
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    },
    querySelectorAll: () => [],
    createElement: element,
    createTextNode: (s) => s,
  };
  const app = new Function(
    "document",
    "window",
    "localStorage",
    "Response",
    source + `
    return { signInWithEmail, verifyEmailCode, applySession,
      runQuery, saveQuiz, checkAnswer, invokeApi, renderQuiz, quizzes, questionIds, loadSavedProgress,
      points() { return earnedQuestions.size * 4; },
      useClient(value) { client = value; },
      isSignedIn() { return signedIn; }
    };
  `,
  )(document, {}, { getItem: () => null }, Response);
  const requests = [];
  const saved = new Map();
  const session = makeSession();
  app.useClient({
    auth: {
      async signInWithOtp(body) {
        requests.push(["send", body]);
        return { error: null };
      },
      async verifyOtp(body) {
        requests.push(["verify", body]);
        return {
          data: { session: verificationError ? null : session },
          error: verificationError,
        };
      },
    },
    functions: {
      async invoke(name, { body }) {
        assert(name === "quiz-api", "Unexpected function");
        requests.push([body.action, body]);
        if (invokeHook) {
          const intercepted = invokeHook(body);
          if (intercepted !== undefined) return intercepted;
        }
        if (body.action === "login") {
          return { data: { recorded: true }, error: loggingError };
        }
        if (body.action === "run") {
          const quiz = app.quizzes[body.questionId];
          return {
            data: { columns: quiz.headers, rows: quiz.rows, truncated: false },
            error: null,
          };
        }
        if (body.action === "save") {
          const progress = {
            question_id: body.questionId,
            query_text: body.query,
            parameters: body.parameters,
          };
          saved.set(body.questionId, progress);
          return { data: { progress }, error: null };
        }
        return { data: { progress: [...saved.values()] }, error: null };
      },
    },
  });
  const get = (selector) => document.querySelector(selector);
  get("#signin-email").value = session.user.email;
  get("#signin-code-form").hidden = true;
  get("#signin-dialog").open = true;
  return { app, get, requests, session };
}
const event = { preventDefault() {} };

Deno.test("request and verify code signs in the original page and records only login action", async () => {
  const { app, get, requests, session } = setup();
  await app.signInWithEmail(event);
  assert(!get("#signin-code-form").hidden, "Code field should appear");
  assert(!app.isSignedIn(), "Requesting a code must not sign in");
  get("#signin-code").value = "123456";
  await app.verifyEmailCode(event);
  assert(app.isSignedIn(), "Original page should be signed in");
  assert(!get("#signin-dialog").open, "Dialog should close");
  assert(!get("#sql-editor").readOnly, "Quiz should unlock");
  assert(get("#signin-code").value === "", "Clear verified code");
  const verify = requests.find(([kind]) => kind === "verify")[1];
  assert(
    verify.email === session.user.email && verify.token === "123456" &&
      verify.type === "email",
    "Wrong verification arguments",
  );
  const login = requests.filter(([kind]) => kind === "login");
  assert(login.length === 1, "Expected one login request");
  assert(
    JSON.stringify(login[0][1]) === '{"action":"login"}',
    "Do not send identity/code/session in login body",
  );
  await app.applySession(session);
  assert(
    requests.filter(([kind]) => kind === "login").length === 1,
    "Session refresh must not log another login",
  );
});

Deno.test("invalid or expired code keeps the dialog open and records no login", async () => {
  const { app, get, requests } = setup({
    verificationError: new Error("Code expired"),
  });
  await app.signInWithEmail(event);
  get("#signin-code").value = "123456";
  await app.verifyEmailCode(event);
  assert(
    !app.isSignedIn() && get("#signin-dialog").open,
    "Failed verification changed auth",
  );
  assert(
    !requests.some(([kind]) => kind === "login"),
    "Failed login was recorded",
  );
  assert(
    get("#signin-message").textContent.includes("Code expired"),
    "Missing feedback",
  );
  assert(
    !get("#verify-code").disabled && !get("#send-magic-link").disabled,
    "Retry buttons should be enabled",
  );
  await app.signInWithEmail(event);
  assert(
    requests.filter(([kind]) => kind === "send").length === 2,
    "Resend should request another code",
  );
});

Deno.test("recording failure keeps the quiz locked and can retry the same valid session", async () => {
  const { app, get } = setup({
    loggingError: { message: "Logging unavailable" },
  });
  await app.signInWithEmail(event);
  get("#signin-code").value = "123456";
  await app.verifyEmailCode(event);
  assert(
    !app.isSignedIn() && get("#sql-editor").readOnly,
    "Quiz must stay locked until login is recorded",
  );
  assert(
    get("#signin-dialog").open,
    "Keep the sign-in dialog open on recording failure",
  );
  assert(
    get("#signin-code").value === "",
    "Do not keep a consumed OTP in the input",
  );
  assert(
    get("#feedback-message").textContent.includes(
      "login transaction could not be recorded",
    ),
    "Missing recording failure feedback",
  );
});

Deno.test("signed-out direct JavaScript calls cannot run, check, invoke, or save", async () => {
  const { app, get, requests } = setup();
  // Simulate someone enabling the buttons and editing the textarea manually.
  get("#sql-editor").value = "SELECT student_id FROM students";
  get("#run-query").disabled = false;
  get("#save-quiz").disabled = false;
  await app.runQuery();
  assert(
    get("#feedback-message").textContent.includes("Sign in"),
    "Direct run must be blocked",
  );
  await app.saveQuiz();
  assert(
    get("#feedback-message").textContent.includes("Sign in"),
    "Direct save must be blocked",
  );
  await app.checkAnswer();
  let rejected = false;
  try {
    await app.invokeApi({ action: "run", query: "SELECT * FROM students" });
  } catch {
    rejected = true;
  }
  assert(
    rejected && requests.length === 0,
    "Signed-out functions sent a backend request",
  );
});

Deno.test("all five hints provide SQL guidance without solutions and display expected output values", async () => {
  const { app, get, session } = setup();
  await app.applySession(session);
  assert(app.questionIds.length === 5, "Expected five questions");
  for (const id of app.questionIds) {
    app.renderQuiz(id);
    const quiz = app.quizzes[id];
    assert(
      get("#sql-editor").value === "",
      "Unanswered editor must stay blank",
    );
    assert(
      get("#hint-sql").textContent === quiz.hint &&
        !get("#hint-sql").textContent.includes(quiz.solution) &&
        /join|group|sort|limit|mean|count|choose/i.test(quiz.hint),
      "Hint must provide useful operations guidance without the full solution",
    );
    assert(
      get("#hint-result-description").textContent.length > 0,
      "Missing expected-result description",
    );
    const table = get("#hint-result-table").children[0].children[0];
    assert(
      table.children[0].children[0].children.length === quiz.headers.length,
      "Missing expected columns",
    );
    assert(
      table.children[1].children.length === quiz.rows.length &&
        quiz.rows.length > 0,
      "Missing expected-result rows",
    );
    const displayedHeaders = table.children[0].children[0].children.map((
      cell,
    ) => cell.textContent);
    const displayedRows = table.children[1].children.map((row) =>
      row.children.map((cell) => cell.textContent)
    );
    assert(
      JSON.stringify(displayedHeaders) === JSON.stringify(quiz.headers),
      "Wrong expected columns",
    );
    assert(
      JSON.stringify(displayedRows) === JSON.stringify(quiz.rows),
      "Expected answer values must remain visible",
    );
  }
});

Deno.test("five questions award exactly four points each, with no duplicate credit", async () => {
  const { app, get, session } = setup();
  await app.applySession(session);
  assert(app.questionIds.length === 5, "Expected five questions");
  for (const id of app.questionIds) {
    app.renderQuiz(id);
    const quiz = app.quizzes[id];
    const before = app.points();
    get("#sql-editor").value = quiz.solution;
    await app.checkAnswer();
    assert(app.points() === before + 4, "Each question must award four points");
    await app.checkAnswer();
    assert(
      app.points() === before + 4,
      "Repeated checks must not award extra points",
    );
  }
  assert(app.points() === 20, "Total must be 20 points");
  assert(
    get("#progress-fill").style.width === "100%",
    "20 points should fill the bar",
  );
});

Deno.test("signed-in frontend sends SQL and parameters, renders returned rows, and saves/restores answers", async () => {
  const { app, get, requests, session } = setup();
  await app.applySession(session);
  assert(!get("#sql-editor").readOnly, "Signed-in editor must be editable");
  const query = "SELECT student_id FROM students WHERE grade_level = $1";
  get("#sql-editor").value = query;
  get("#query-parameters").value = '["Grade 9"]';
  await app.runQuery();
  const run = requests.find(([kind]) => kind === "run")[1];
  assert(
    run.query === query && run.parameters[0] === "Grade 9",
    "Query/parameters were not passed to quiz-api",
  );
  const table = get("#results-content").children[0].children[0];
  assert(
    table.children[1].children.length > 0,
    "Returned rows were not rendered",
  );
  assert(
    get("#result-state").textContent === "EXECUTED",
    "Missing execution feedback",
  );
  await app.saveQuiz();
  assert(
    get("#feedback-message").textContent.includes("saved"),
    "Save not confirmed",
  );
  assert(app.points() === 0, "Saving must not award points");
  app.renderQuiz("average-gpa");
  app.renderQuiz("top-students");
  assert(get("#sql-editor").value === query, "Saved answer was not restored");
  const restored = setup({
    invokeHook: (body) =>
      body.action === "load"
        ? {
          data: {
            progress: [{
              question_id: "top-students",
              query_text: query,
              parameters: ["Grade 9"],
            }],
          },
          error: null,
        }
        : undefined,
  });
  await restored.app.applySession(restored.session);
  assert(
    restored.get("#sql-editor").value === query,
    "Backend load did not restore saved answer",
  );
});

Deno.test("same-session token refresh preserves drafts, parameters, results, and points", async () => {
  const { app, get, requests, session } = setup();
  await app.applySession(session);
  get("#sql-editor").value = app.quizzes["top-students"].solution;
  await app.checkAnswer();
  get("#sql-editor").value =
    "SELECT first_name FROM students WHERE grade_level = $1";
  get("#query-parameters").value = '["Grade 9"]';
  await app.runQuery();
  const results = get("#results-content").children;
  const before = requests.length;
  await app.applySession(
    makeSession("user-a", "00000000-0000-0000-0000-000000000001", true),
  );
  assert(
    get("#sql-editor").value.includes("first_name"),
    "Refresh erased draft",
  );
  assert(
    get("#query-parameters").value === '["Grade 9"]',
    "Refresh erased parameters",
  );
  assert(
    get("#results-content").children === results && app.points() === 4,
    "Refresh reset results/points",
  );
  assert(
    requests.length === before,
    "Refresh must not reload or record another login",
  );
});

Deno.test("repeated auth callbacks share login recording and wait before unlocking", async () => {
  const login = deferred();
  const { app, get, session, requests } = setup({
    invokeHook: (body) => body.action === "login" ? login.promise : undefined,
  });
  const first = app.applySession(session);
  const second = app.applySession(session);
  assert(
    !app.isSignedIn() && get("#sql-editor").readOnly &&
      get("#signin-dialog").open,
    "Unlocked before recording login",
  );
  assert(
    requests.filter(([kind]) => kind === "login").length === 1,
    "Duplicate callback sent duplicate login",
  );
  login.resolve({ data: { recorded: true }, error: null });
  await Promise.all([first, second]);
  assert(
    app.isSignedIn() && !get("#signin-dialog").open,
    "Did not unlock after recording",
  );
  await app.applySession(
    makeSession("user-a", "00000000-0000-0000-0000-000000000002"),
  );
  assert(
    requests.filter(([kind]) => kind === "login").length === 2,
    "New session must record a new login",
  );
});

Deno.test("failed login recording retries without another OTP and sign-out cancels pending initialization", async () => {
  let fail = true;
  const fixture = setup({
    invokeHook: (body) =>
      body.action === "login" && fail
        ? { error: { message: "offline" } }
        : undefined,
  });
  await fixture.app.applySession(fixture.session);
  assert(!fixture.app.isSignedIn(), "Unlocked after failed recording");
  fail = false;
  await fixture.app.applySession(fixture.session);
  assert(fixture.app.isSignedIn(), "Valid session did not retry recording");
  const pending = deferred();
  const second = setup({
    invokeHook: (body) => body.action === "login" ? pending.promise : undefined,
  });
  const attempt = second.app.applySession(second.session);
  await second.app.applySession(null);
  pending.resolve({ data: { recorded: true }, error: null });
  await attempt;
  assert(!second.app.isSignedIn(), "Late login unlocked a signed-out page");
});

Deno.test("late saved-progress load cannot overwrite typing or another user's state", async () => {
  let pending = null;
  const { app, get, session } = setup({
    invokeHook: (body) =>
      body.action === "load" && pending ? pending.promise : undefined,
  });
  await app.applySession(session);
  pending = deferred();
  const load = app.loadSavedProgress();
  get("#sql-editor").value = "my draft";
  get("#sql-editor").listeners.input();
  pending.resolve({
    data: {
      progress: [{
        question_id: "top-students",
        query_text: "older saved query",
        parameters: [],
      }],
    },
    error: null,
  });
  await load;
  assert(get("#sql-editor").value === "my draft", "Load overwrote typing");
  pending = deferred();
  const oldLoad = app.loadSavedProgress();
  await app.applySession(null);
  pending.resolve({
    data: {
      progress: [{
        question_id: "top-students",
        query_text: "private answer",
        parameters: [],
      }],
    },
    error: null,
  });
  await oldLoad;
  app.renderQuiz("top-students");
  assert(
    get("#sql-editor").value === "",
    "Old-user load restored data after sign-out",
  );
});

Deno.test("delayed save stays attached to its original question", async () => {
  const pending = deferred();
  const { app, get, session } = setup({
    invokeHook: (body) => body.action === "save" ? pending.promise : undefined,
  });
  await app.applySession(session);
  const query = "SELECT first_name FROM students";
  get("#sql-editor").value = query;
  const saving = app.saveQuiz();
  app.renderQuiz("average-gpa");
  get("#sql-editor").value = "second question draft";
  pending.resolve({
    data: {
      progress: {
        question_id: "top-students",
        query_text: query,
        parameters: [],
      },
    },
    error: null,
  });
  await saving;
  assert(
    get("#sql-editor").value === "second question draft",
    "Save changed another editor",
  );
  app.renderQuiz("average-gpa");
  assert(
    get("#sql-editor").value === "",
    "Save cached under the wrong question",
  );
  app.renderQuiz("top-students");
  assert(
    get("#sql-editor").value === query,
    "Save missing from original question",
  );
});

Deno.test("save response cannot leak across users", async () => {
  const pending = deferred();
  const { app, get, session } = setup({
    invokeHook: (body) => body.action === "save" ? pending.promise : undefined,
  });
  await app.applySession(session);
  get("#sql-editor").value = "first user's answer";
  const saving = app.saveQuiz();
  await app.applySession(makeSession("user-b"));
  pending.resolve({
    data: {
      progress: {
        question_id: "top-students",
        query_text: "first user's answer",
        parameters: [],
      },
    },
    error: null,
  });
  await saving;
  app.renderQuiz("top-students");
  assert(get("#sql-editor").value === "", "Previous user's answer leaked");
});

for (const fail of [false, true]) {
  Deno.test(`late query ${fail ? "error" : "result"} cannot appear on a different question`, async () => {
    const pending = deferred();
    const { app, get, session } = setup({
      invokeHook: (body) => body.action === "run" ? pending.promise : undefined,
    });
    await app.applySession(session);
    get("#sql-editor").value = "SELECT student_id FROM students";
    const running = app.runQuery();
    app.renderQuiz("average-gpa");
    if (fail) pending.reject(new Error("old query failed"));
    else {pending.resolve({
        data: {
          columns: ["student_id"],
          rows: [["student_001"]],
          truncated: false,
        },
        error: null,
      });}
    await running;
    assert(
      get("#results-heading").textContent === "Run a query to see results",
      "Old result changed new question",
    );
    assert(
      get("#feedback-message").textContent === "",
      "Old feedback appeared on new question",
    );
  });
}

Deno.test("older query completion cannot unlock a newer pending run", async () => {
  const runs = [];
  const { app, get, session } = setup({
    invokeHook: (body) => {
      if (body.action === "run") {
        const pending = deferred();
        runs.push(pending);
        return pending.promise;
      }
    },
  });
  await app.applySession(session);
  get("#sql-editor").value = "SELECT student_id FROM students";
  const first = app.runQuery();
  app.renderQuiz("average-gpa");
  get("#sql-editor").value = "SELECT school_name FROM schools";
  const second = app.runQuery();
  runs[0].resolve({
    data: {
      columns: ["student_id"],
      rows: [["student_001"]],
      truncated: false,
    },
    error: null,
  });
  await first;
  assert(
    get("#run-query").disabled,
    "Older run enabled button while newer run is pending",
  );
  runs[1].resolve({
    data: {
      columns: ["school_name"],
      rows: [["Example school"]],
      truncated: false,
    },
    error: null,
  });
  await second;
  assert(
    get("#results-heading").textContent === "Query results" &&
      !get("#run-query").disabled,
    "New query did not complete normally",
  );
});
