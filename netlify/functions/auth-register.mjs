import { json, preflight, readBody, supabaseAuth, fail } from "./_shared.mjs";
export default async event => {
  const pf = preflight(event); if (pf) return pf;
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST." });
  try {
    const b = await readBody(event);
    const email = String(b.email || "").trim().toLowerCase();
    const password = String(b.password || "");
    const fullName = String(b.fullName || "").trim().slice(0, 100);
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email address.");
    if (password.length < 10) throw new Error("Use a password with at least 10 characters.");
    if (!fullName) throw new Error("Enter your full name.");
    const result = await supabaseAuth("/auth/v1/signup", { method: "POST", body: JSON.stringify({ email, password, data: { full_name: fullName } }) });
    return json(200, { user: result.user || result, session: result.session || null, message: result.session ? "Account created and signed in." : "Account created. Check your email to confirm it, then sign in." });
  } catch (e) { return fail(e); }
};
