import { json, preflight, readBody, supabaseAuth, fail } from "./_shared.mjs";
export default async event => {
  const pf = preflight(event); if (pf) return pf;
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST." });
  try {
    const b = await readBody(event);
    const result = await supabaseAuth("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email: String(b.email || "").trim().toLowerCase(), password: String(b.password || "") }) });
    if (!result.access_token) throw new Error("Email may need confirmation, or the email/password is incorrect.");
    return json(200, { session: { access_token: result.access_token, refresh_token: result.refresh_token, expires_at: result.expires_at, token_type: result.token_type }, user: result.user });
  } catch (e) { return fail(e); }
};
