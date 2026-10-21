import { getLoginSession } from "./login-session.ts";

const userId = "00000000-0000-0000-0000-000000000001";
const sessionId = "00000000-0000-0000-0000-000000000002";
function request(claims: Record<string, unknown>): Request {
  return new Request("https://example.test", {
    headers: {
      Authorization: `Bearer header.${btoa(JSON.stringify(claims))}.signature`,
    },
  });
}

Deno.test("extracts the OTP session from an already verified token", () => {
  const result = getLoginSession(
    request({
      sub: userId,
      session_id: sessionId,
      amr: [{ method: "otp" }],
    }),
    userId,
  );
  if (result !== sessionId) throw new Error("Wrong session ID");
});

Deno.test("rejects missing session, another user, and non-OTP authentication", () => {
  const valid = {
    sub: userId,
    session_id: sessionId,
    amr: [{ method: "otp" }],
  };
  for (
    const claims of [
      { ...valid, sub: "another-user" },
      { ...valid, session_id: null },
      { ...valid, session_id: "not-a-uuid" },
      { ...valid, amr: [{ method: "password" }] },
      { ...valid, amr: null },
    ]
  ) {
    let rejected = false;
    try {
      getLoginSession(request(claims), userId);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("Invalid claims accepted");
  }
});
