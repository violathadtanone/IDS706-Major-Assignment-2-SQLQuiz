/** Call only AFTER Supabase Auth has verified this request's bearer token. */
export function getLoginSession(
  request: Request,
  verifiedUserId: string,
): string {
  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)
    ?.[1];
  try {
    const payload = token?.split(".")[1];
    if (!payload) throw new Error("Missing token payload");
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(
      atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
    );
    if (
      claims.sub !== verifiedUserId ||
      typeof claims.session_id !== "string" ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(
        claims.session_id,
      ) ||
      !Array.isArray(claims.amr) ||
      !claims.amr.some((entry: { method?: string } | null) =>
        entry?.method === "otp"
      )
    ) {
      throw new Error("Missing email sign-in session");
    }
    return claims.session_id;
  } catch {
    throw new Error(
      "A verified email sign-in session is required to record a login.",
    );
  }
}
