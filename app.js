const quizzes = {
  "top-students": {
    number: "01",
    title: "Who are the top 10 students by GPA?",
    level: "EASY",
    prompt:
      "Who are the 10 students with the highest GPA? Return each student's ID, name, grade level, and GPA, ordered from highest to lowest.",
    starter:
      "SELECT student_id, first_name, last_name, grade_level, gpa\nFROM students\nORDER BY gpa DESC\nLIMIT 10;",
    solution: `SELECT
    student_id,
    first_name,
    last_name,
    grade_level,
    gpa
FROM students
ORDER BY gpa DESC
LIMIT 10;`,
    headers: ["student_id", "first_name", "last_name", "grade_level", "gpa"],
    resultDescription: "The 10 highest-GPA students in the seed data.",
    rows: [
      ["student_074", "Lucas", "Murphy", "Grade 12", "3.97"],
      ["student_081", "Henry", "Davis", "Grade 9", "3.92"],
      ["student_040", "Ava", "Jenkins", "Grade 9", "3.89"],
      ["student_014", "Harper", "Kim", "Grade 12", "3.86"],
      ["student_002", "James", "Adams", "Grade 12", "3.83"],
      ["student_027", "Luna", "Wilson", "Grade 11", "3.82"],
      ["student_093", "Daniel", "Richardson", "Grade 9", "3.82"],
      ["student_047", "Layla", "Harris", "Grade 9", "3.81"],
      ["student_050", "Camila", "Ramirez", "Grade 11", "3.80"],
      ["student_053", "Ethan", "Clark", "Grade 10", "3.79"],
    ],
    checks: [
      {
        label: "selects records from students",
        test: (sql) => /\bselect\b[\s\S]*\bfrom\s+students\b/i.test(sql),
      },
      {
        label: "orders GPA from highest to lowest",
        test: (sql) => /\border\s+by\s+(?:st\.)?gpa\s+desc\b/i.test(sql),
      },
      {
        label: "limits the result to 10",
        test: (sql) => /\blimit\s+10\b/i.test(sql),
      },
    ],
  },
  "average-gpa": {
    number: "02",
    title: "What is the average GPA at each school?",
    level: "MEDIUM",
    prompt:
      "Calculate the average GPA for students at each school. Show the school name and the average rounded to two decimal places, highest average first.",
    starter:
      "SELECT s.school_name, ROUND(AVG(st.gpa), 2) AS average_gpa\nFROM schools s\nJOIN students st ON s.school_id = st.school_id\n-- Group by school and order by the average",
    solution: `SELECT
    s.school_name,
    ROUND(AVG(st.gpa), 2) AS average_gpa
FROM schools s
JOIN students st
    ON s.school_id = st.school_id
GROUP BY s.school_id, s.school_name
ORDER BY average_gpa DESC;`,
    headers: ["school_name", "average_gpa"],
    resultDescription:
      "The average GPA by school. Only schools with students appear in this inner-join result.",
    rows: [
      ["Queen City Preparatory", "3.43"],
      ["Lakewood High School", "3.38"],
      ["Blue Ridge High School", "3.34"],
      ["Gate City Academy", "3.26"],
      ["Oak Ridge High School", "3.22"],
      ["Maple Grove High School", "3.22"],
      ["Cedar Hill High School", "3.19"],
      ["Capital View Academy", "3.18"],
      ["Pinecrest Academy", "3.02"],
    ],
    checks: [
      {
        label: "joins schools to students by school_id",
        test: (sql) =>
          /\bfrom\s+schools\s+(?:as\s+)?s\b[\s\S]*\bjoin\s+students\s+(?:as\s+)?st\b[\s\S]*\bs\.school_id\s*=\s*st\.school_id\b/i.test(
            sql,
          ),
      },
      {
        label: "calculates and rounds the average GPA",
        test: (sql) => /\bround\s*\(\s*avg\s*\(\s*st\.gpa\s*\)\s*,\s*2\s*\)/i.test(sql),
      },
      {
        label: "groups by school",
        test: (sql) =>
          /\bgroup\s+by\b[\s\S]*\bs\.school_id\b[\s\S]*\bs\.school_name\b/i.test(sql),
      },
    ],
  },
  "student-count": {
    number: "03",
    title: "Which 5 schools serve the most students?",
    level: "MEDIUM",
    prompt:
      "All students in this dataset are enrolled in the free lunch program. Find the five schools with the most participating students, from the largest student count to the smallest.",
    starter:
      "SELECT s.school_name, COUNT(st.student_id) AS student_count\nFROM schools s\nJOIN students st ON s.school_id = st.school_id\n-- Group by school, sort by count, and return 5",
    solution: `SELECT
    s.school_name,
    COUNT(st.student_id) AS student_count
FROM schools s
JOIN students st
    ON s.school_id = st.school_id
GROUP BY s.school_id, s.school_name
ORDER BY student_count DESC
LIMIT 5;`,
    headers: ["school_name", "student_count"],
    resultDescription:
      "The five schools with the most free-lunch students. LIMIT 5 follows the question wording.",
    rows: [
      ["Cedar Hill High School", "20"],
      ["Oak Ridge High School", "18"],
      ["Maple Grove High School", "16"],
      ["Lakewood High School", "14"],
      ["Capital View Academy", "9"],
    ],
    checks: [
      {
        label: "joins schools to students by school_id",
        test: (sql) =>
          /\bfrom\s+schools\s+(?:as\s+)?s\b[\s\S]*\bjoin\s+students\s+(?:as\s+)?st\b[\s\S]*\bs\.school_id\s*=\s*st\.school_id\b/i.test(
            sql,
          ),
      },
      {
        label: "counts students",
        test: (sql) => /\bcount\s*\(\s*st\.student_id\s*\)/i.test(sql),
      },
      {
        label: "returns the top five schools",
        test: (sql) =>
          /\border\s+by\s+student_count\s+desc\b/i.test(sql) && /\blimit\s+5\b/i.test(sql),
      },
    ],
  },
  "city-cost": {
    number: "04",
    title: "What is the average lunch cost in each city?",
    level: "ADVANCED",
    prompt:
      "For each city, calculate the average price of a recorded student meal. Show the city and average lunch cost rounded to two decimals, highest first.",
    starter:
      "SELECT s.city, ROUND(AVG(m.price), 2) AS average_lunch_cost\nFROM schools s\nJOIN students st ON s.school_id = st.school_id\nJOIN meals m ON st.student_id = m.student_id\n-- Group by city and order by the average",
    solution: `SELECT
    s.city,
    ROUND(AVG(m.price), 2) AS average_lunch_cost
FROM schools s
JOIN students st
    ON s.school_id = st.school_id
JOIN meals m
    ON st.student_id = m.student_id
GROUP BY s.city
ORDER BY average_lunch_cost DESC;`,
    headers: ["city", "average_lunch_cost"],
    resultDescription:
      "Average meal transaction price in each city represented in the meal records.",
    rows: [
      ["Asheville", "4.56"],
      ["Raleigh", "4.53"],
      ["Charlotte", "4.53"],
      ["Greensboro", "4.52"],
      ["Durham", "4.52"],
    ],
    checks: [
      {
        label: "joins schools, students, and meals",
        test: (sql) =>
          /\bfrom\s+schools\s+(?:as\s+)?s\b[\s\S]*\bjoin\s+students\s+(?:as\s+)?st\b[\s\S]*\bs\.school_id\s*=\s*st\.school_id\b[\s\S]*\bjoin\s+meals\s+(?:as\s+)?m\b[\s\S]*\bst\.student_id\s*=\s*m\.student_id\b/i.test(
            sql,
          ),
      },
      {
        label: "calculates average meal price rounded to two decimals",
        test: (sql) =>
          /\bround\s*\(\s*avg\s*\(\s*m\.price\s*\)\s*,\s*2\s*\)/i.test(sql),
      },
      {
        label: "groups results by city",
        test: (sql) => /\bgroup\s+by\s+s\.city\b/i.test(sql),
      },
    ],
  },
  "school-cost": {
    number: "05",
    title: "Which schools have the highest lunch costs?",
    level: "ADVANCED",
    prompt:
      "Find the 10 schools with the highest total cost of recorded meal transactions. Include school, city, number of meals, and total lunch cost rounded to two decimals.",
    starter:
      "SELECT s.school_name, s.city, COUNT(m.meal_id) AS total_meals,\n       ROUND(SUM(m.price), 2) AS total_lunch_cost\nFROM schools s\nJOIN students st ON s.school_id = st.school_id\nJOIN meals m ON st.student_id = m.student_id\n-- Group by school, sort by cost, and return 10",
    solution: `SELECT
    s.school_name,
    s.city,
    COUNT(m.meal_id) AS total_meals,
    ROUND(SUM(m.price), 2) AS total_lunch_cost
FROM schools s
JOIN students st
    ON s.school_id = st.school_id
JOIN meals m
    ON st.student_id = m.student_id
GROUP BY s.school_id, s.school_name, s.city
ORDER BY total_lunch_cost DESC
LIMIT 10;`,
    headers: ["school_name", "city", "total_meals", "total_lunch_cost"],
    resultDescription:
      "There are meal transactions for nine schools in the seed data, so the top-10 query returns nine rows.",
    rows: [
      ["Cedar Hill High School", "Charlotte", "77", "349.45"],
      ["Oak Ridge High School", "Durham", "75", "338.50"],
      ["Maple Grove High School", "Raleigh", "64", "290.65"],
      ["Lakewood High School", "Greensboro", "59", "267.40"],
      ["Capital View Academy", "Raleigh", "42", "189.45"],
      ["Gate City Academy", "Greensboro", "33", "148.40"],
      ["Pinecrest Academy", "Durham", "28", "126.90"],
      ["Queen City Preparatory", "Charlotte", "23", "103.80"],
      ["Blue Ridge High School", "Asheville", "10", "45.65"],
    ],
    checks: [
      {
        label: "joins schools, students, and meals",
        test: (sql) =>
          /\bfrom\s+schools\s+(?:as\s+)?s\b[\s\S]*\bjoin\s+students\s+(?:as\s+)?st\b[\s\S]*\bs\.school_id\s*=\s*st\.school_id\b[\s\S]*\bjoin\s+meals\s+(?:as\s+)?m\b[\s\S]*\bst\.student_id\s*=\s*m\.student_id\b/i.test(
            sql,
          ),
      },
      {
        label: "counts meals and sums the meal price",
        test: (sql) =>
          /\bcount\s*\(\s*m\.meal_id\s*\)/i.test(sql) &&
          /\bround\s*\(\s*sum\s*\(\s*m\.price\s*\)\s*,\s*2\s*\)/i.test(sql),
      },
      {
        label: "groups by school and limits the result to 10",
        test: (sql) =>
          /\bgroup\s+by\b[\s\S]*\bs\.school_id\b[\s\S]*\bs\.school_name\b[\s\S]*\bs\.city\b/i.test(
            sql,
          ) &&
          /\border\s+by\s+total_lunch_cost\s+desc\b/i.test(sql) &&
          /\blimit\s+10\b/i.test(sql),
      },
    ],
  },
};

const questionIds = Object.keys(quizzes);
const editor = document.querySelector("#sql-editor");
const paramsInput = document.querySelector("#query-parameters");
const lineNumbers = document.querySelector("#line-numbers");
const feedback = document.querySelector("#feedback-message");
const resultHeading = document.querySelector("#results-heading");
const resultState = document.querySelector("#result-state");
const resultsContent = document.querySelector("#results-content");
const resultsFootnote = document.querySelector("#results-footnote");
const saveStatus = document.querySelector("#save-status");
const navItems = [...document.querySelectorAll(".quiz-nav-item")];
const authStatus = document.querySelector("#auth-status");
const signInButton = document.querySelector("#sign-in");
const signOutButton = document.querySelector("#sign-out");
const signInDialog = document.querySelector("#signin-dialog");
const signInForm = document.querySelector("#signin-form");
const signInMessage = document.querySelector("#signin-message");
const editorAccess = document.querySelector("#editor-access");
const checkButton = document.querySelector("#check-answer");
const saveButton = document.querySelector("#save-quiz");
const runButton = document.querySelector("#run-query");

let currentQuizId = questionIds[0];
let currentUser = null;
let signedIn = false;
let answerChecked = false;
let savedProgress = {};
let client = null;

function showFeedback(message, type = "") {
  feedback.textContent = message;
  feedback.className = `feedback-message${type ? ` is-${type}` : ""}`;
}

function setSignInMessage(message, type = "") {
  signInMessage.textContent = message;
  signInMessage.className = `signin-message${type ? ` is-${type}` : ""}`;
}

function getCurrentQuiz() {
  return quizzes[currentQuizId];
}

function parseParameters() {
  const raw = paramsInput.value.trim();
  if (!raw) {
    return [];
  }

  let values;
  try {
    values = JSON.parse(raw);
  } catch {
    throw new Error("Parameters must be a valid JSON array, such as [\"Grade 9\", 10].");
  }

  if (!Array.isArray(values)) {
    throw new Error("Parameters must be a JSON array.");
  }
  if (
    values.length > 20 ||
    values.some(
      (value) =>
        value !== null &&
        typeof value !== "string" &&
        typeof value !== "boolean" &&
        !(typeof value === "number" && Number.isFinite(value)),
    )
  ) {
    throw new Error("Use up to 20 string, number, boolean, or null parameter values.");
  }
  return values;
}

function updateLineNumbers() {
  const lineCount = Math.max(1, editor.value.split("\n").length);
  lineNumbers.textContent = Array.from(
    { length: lineCount },
    (_, index) => index + 1,
  ).join("\n");
}

function updateSaveButton() {
  const alreadySaved = Boolean(savedProgress[currentQuizId]);
  saveButton.disabled = !signedIn;
  saveButton.textContent = alreadySaved ? "Update saved query" : "Save quiz";
}

function updateProgress() {
  const savedCount = signedIn ? Object.keys(savedProgress).length : 0;
  document.querySelector("#progress-count").innerHTML =
    `${savedCount} <span>/ 5</span>`;
  document.querySelector("#progress-fill").style.width = `${savedCount * 20}%`;
  document.querySelector("#progress-bar").setAttribute("aria-valuenow", savedCount);
  document.querySelector("#progress-caption").textContent = signedIn
    ? `${savedCount} of 5 questions saved to your account`
    : "5 questions · 4 points each";

  for (const item of navItems) {
    item.classList.toggle(
      "is-complete",
      signedIn && Boolean(savedProgress[item.dataset.quiz]),
    );
  }
}

function updateAuthControls() {
  const dot = document.createElement("span");
  dot.className = "status-dot";
  dot.setAttribute("aria-hidden", "true");
  authStatus.replaceChildren(
    dot,
    document.createTextNode(signedIn ? currentUser?.email ?? "Signed in" : "Signed out"),
  );
  authStatus.classList.toggle("is-signed-in", signedIn);
  signInButton.classList.toggle("is-hidden", signedIn);
  signOutButton.classList.toggle("is-hidden", !signedIn);
  document.querySelector("#signin-callout").classList.toggle("is-hidden", signedIn);
  editor.readOnly = !signedIn;
  paramsInput.disabled = !signedIn;
  runButton.disabled = !signedIn;
  checkButton.disabled = !signedIn;
  saveButton.disabled = !signedIn;
  editorAccess.textContent = signedIn ? "Signed-in workspace · editable" : "Sign in to edit";
  saveStatus.textContent = signedIn ? "Saved to your account on request" : "Sign in to save";
  document.querySelector("#preview-note").textContent = signedIn
    ? "Runs on Supabase · read-only SQL"
    : "Sign in to run queries and save your quiz.";
  updateProgress();
  updateSaveButton();
}

function renderTable(headers, rows, container) {
  const wrapper = document.createElement("div");
  wrapper.className = "results-table-wrap";
  const table = document.createElement("table");
  table.className = "results-table";
  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");

  headers.forEach((label) => {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    headerRow.append(cell);
  });
  head.append(headerRow);

  const body = document.createElement("tbody");
  rows.forEach((row) => {
    const tableRow = document.createElement("tr");
    row.forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value === null ? "NULL" : String(value);
      tableRow.append(cell);
    });
    body.append(tableRow);
  });

  table.append(head, body);
  wrapper.append(table);
  container.replaceChildren(wrapper);
}

function renderHint(quiz) {
  document.querySelector("#hint-sql").textContent = quiz.solution;
  document.querySelector("#hint-result-description").textContent =
    quiz.resultDescription;
  renderTable(quiz.headers, quiz.rows, document.querySelector("#hint-result-table"));
}

function clearResults() {
  resultHeading.textContent = "Run a query to see results";
  resultState.textContent = signedIn ? "READY" : "LOCKED";
  resultState.classList.remove("is-ready");
  resultsContent.innerHTML = `
    <div class="empty-results">
      <div class="empty-icon" aria-hidden="true">⌕</div>
      <p>${signedIn ? "Ready when you are." : "Sign in to unlock query tools."}</p>
      <span>${
        signedIn
          ? "The query will run against Supabase when you choose Run query."
          : "Sign in to run your query against the student lunch dataset."
      }</span>
    </div>`;
  resultsFootnote.textContent = signedIn
    ? "Only read-only SELECT queries against schools, students, and meals are allowed."
    : "Query execution is available to signed-in users.";
}

function renderQuiz(quizId) {
  currentQuizId = quizId;
  answerChecked = false;
  const quiz = getCurrentQuiz();
  document.querySelector("#challenge-kicker").innerHTML =
    `QUESTION ${quiz.number} <span>•</span> ${quiz.level}`;
  document.querySelector("#challenge-title").textContent = quiz.title;
  document.querySelector("#challenge-prompt").textContent = quiz.prompt;
  document.querySelector(".points-pill").innerHTML = "<strong>4</strong> POINTS";
  renderHint(quiz);

  const saved = signedIn ? savedProgress[quizId] : null;
  editor.value = saved?.query_text ?? quiz.starter;
  paramsInput.value = saved?.parameters
    ? JSON.stringify(saved.parameters)
    : "";
  updateLineNumbers();
  clearResults();
  showFeedback("");

  navItems.forEach((item) => {
    const isActive = item.dataset.quiz === quizId;
    item.classList.toggle("is-active", isActive);
    if (isActive) {
      item.setAttribute("aria-current", "step");
    } else {
      item.removeAttribute("aria-current");
    }
  });
  updateAuthControls();
}

async function invokeApi(body) {
  if (!client || !signedIn) {
    throw new Error("Sign in before using the quiz backend.");
  }
  const { data, error } = await client.functions.invoke("quiz-api", { body });
  if (error) {
    let message = error.message || "The quiz backend request failed.";
    if (error.context instanceof Response) {
      try {
        const body = await error.context.json();
        if (typeof body.error === "string") {
          message = body.error;
        }
      } catch {
        // Keep the SDK's error message if the response is not JSON.
      }
    }
    throw new Error(message);
  }
  return data;
}

async function loadSavedProgress() {
  if (!signedIn) {
    savedProgress = {};
    updateProgress();
    return;
  }
  try {
    const data = await invokeApi({ action: "load" });
    savedProgress = Object.fromEntries(
      (data.progress ?? []).map((entry) => [entry.question_id, entry]),
    );
    if (savedProgress[currentQuizId]) {
      editor.value = savedProgress[currentQuizId].query_text;
      paramsInput.value = JSON.stringify(savedProgress[currentQuizId].parameters ?? []);
      updateLineNumbers();
    }
    updateProgress();
    updateSaveButton();
  } catch (error) {
    showFeedback(`Could not load saved quizzes: ${error.message}`, "error");
  }
}

async function applySession(session) {
  currentUser = session?.user ?? null;
  signedIn = Boolean(currentUser);
  if (!signedIn) {
    savedProgress = {};
  }
  updateAuthControls();
  renderQuiz(currentQuizId);
  if (signedIn) {
    await loadSavedProgress();
    setSignInMessage("");
  }
}

async function signInWithEmail(event) {
  event.preventDefault();
  if (!client) {
    setSignInMessage(
      "Supabase is not configured. Add your Supabase URL and publishable key in the deployment settings.",
      "error",
    );
    return;
  }

  const email = document.querySelector("#signin-email").value.trim();
  const button = document.querySelector("#send-magic-link");
  button.disabled = true;
  button.textContent = "Sending…";
  setSignInMessage("");
  try {
    const redirectTo = window.location.href.split(/[?#]/, 1)[0];
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) {
      throw error;
    }
    setSignInMessage("Check your email for a one-time sign-in link.", "success");
  } catch (error) {
    setSignInMessage(`Could not send a sign-in link: ${error.message}`, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Send sign-in link";
  }
}

async function runQuery() {
  if (!signedIn) {
    showFeedback("Sign in before running a query.", "error");
    return;
  }
  let parameters;
  try {
    parameters = parseParameters();
  } catch (error) {
    showFeedback(error.message, "error");
    return;
  }
  runButton.disabled = true;
  runButton.textContent = "Running…";
  resultHeading.textContent = "Running your query…";
  resultState.textContent = "RUNNING";
  resultState.classList.remove("is-ready");
  try {
    const data = await invokeApi({
      action: "run",
      questionId: currentQuizId,
      query: editor.value,
      parameters,
    });
    renderTable(data.columns, data.rows, resultsContent);
    resultHeading.textContent = "Query results";
    resultState.textContent = "EXECUTED";
    resultState.classList.add("is-ready");
    resultsFootnote.textContent = data.truncated
      ? `Showing the first ${data.rows.length} rows. Results are capped for safety.`
      : `${data.rows.length} row${data.rows.length === 1 ? "" : "s"} returned from Supabase.`;
    showFeedback("Query ran successfully.", "success");
  } catch (error) {
    resultHeading.textContent = "Query could not be completed";
    resultState.textContent = "ERROR";
    resultsContent.innerHTML = "";
    showFeedback(error.message, "error");
  } finally {
    runButton.disabled = !signedIn;
    runButton.innerHTML =
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4.5 8 5.5-8 5.5z" /></svg> Run query';
  }
}

async function saveQuiz() {
  if (!signedIn) {
    showFeedback("Sign in before saving quiz progress.", "error");
    return;
  }
  let parameters;
  try {
    parameters = parseParameters();
  } catch (error) {
    showFeedback(error.message, "error");
    return;
  }

  saveButton.disabled = true;
  saveButton.textContent = "Saving…";
  try {
    const data = await invokeApi({
      action: "save",
      questionId: currentQuizId,
      query: editor.value,
      parameters,
    });
    savedProgress[currentQuizId] = data.progress;
    updateProgress();
    showFeedback("Your query and parameters were saved to your account.", "success");
  } catch (error) {
    showFeedback(`Could not save this question: ${error.message}`, "error");
  } finally {
    updateSaveButton();
  }
}

async function signOut() {
  if (!client) {
    return;
  }
  const { error } = await client.auth.signOut();
  if (error) {
    showFeedback(`Could not sign out: ${error.message}`, "error");
  }
}

for (const item of navItems) {
  item.addEventListener("click", () => renderQuiz(item.dataset.quiz));
}

editor.addEventListener("input", () => {
  answerChecked = false;
  updateLineNumbers();
});

editor.addEventListener("scroll", () => {
  lineNumbers.scrollTop = editor.scrollTop;
});

editor.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    editor.setRangeText("    ", editor.selectionStart, editor.selectionEnd, "end");
    updateLineNumbers();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    runQuery();
  }
});

paramsInput.addEventListener("input", () => {
  answerChecked = false;
});

checkButton.addEventListener("click", () => {
  const sql = editor.value
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trim();
  let parameters;
  try {
    parameters = parseParameters();
  } catch (error) {
    showFeedback(error.message, "error");
    return;
  }
  const missing = getCurrentQuiz().checks
    .filter((check) => !check.test(sql))
    .map((check) => check.label);
  const referencedParameters = [...sql.matchAll(/\$(\d+)\b/g)].map((match) =>
    Number(match[1]),
  );
  const highestParameter = Math.max(0, ...referencedParameters);
  if (highestParameter !== parameters.length) {
    missing.push(
      `a JSON parameter value for each SQL placeholder ($1 through $${highestParameter})`,
    );
  }

  if (missing.length > 0) {
    answerChecked = false;
    showFeedback(`Check that your query ${missing.join(", and ")}.`, "error");
    return;
  }
  answerChecked = true;
  showFeedback(
    "The query has the expected structure. Run it against Supabase to inspect the actual rows.",
    "success",
  );
});

runButton.addEventListener("click", runQuery);
saveButton.addEventListener("click", saveQuiz);
signInButton.addEventListener("click", () => {
  setSignInMessage("");
  signInDialog.showModal();
});
document.querySelector("#callout-sign-in").addEventListener("click", () => {
  setSignInMessage("");
  signInDialog.showModal();
});
signOutButton.addEventListener("click", signOut);
signInForm.addEventListener("submit", signInWithEmail);

const config = window.SUPABASE_CONFIG ?? {};
if (
  window.supabase?.createClient &&
  typeof config.url === "string" &&
  typeof config.anonKey === "string" &&
  config.url.startsWith("https://") &&
  config.anonKey.length > 0
) {
  client = window.supabase.createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  client.auth.onAuthStateChange((_event, session) => {
    queueMicrotask(() => applySession(session));
  });
  client.auth.getSession().then(({ data, error }) => {
    if (error) {
      showFeedback(`Could not check your Supabase session: ${error.message}`, "error");
      return;
    }
    applySession(data.session);
  });
} else {
  setSignInMessage(
    "Supabase configuration is missing. The quiz remains locked until the deployment is configured.",
  );
}

updateAuthControls();
renderQuiz(currentQuizId);
