import { json, preflight, requireUser, adminRest, fail } from "./_shared.mjs";
export default async event => {
  const pf = preflight(event); if (pf) return pf;
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST." });
  try {
    const user = await requireUser(event);
    const existing = await adminRest("mkulima_trials", { query: "?select=user_id,starts_at,ends_at&user_id=eq." + encodeURIComponent(user.id) + "&limit=1" });
    if (existing.length) return json(200, { trial: existing[0], alreadyStarted: true, message: "This account has already used its Discovery Pass." });
    const now = new Date(), end = new Date(now.getTime() + 72 * 60 * 60 * 1000);
    try {
      const created = await adminRest("mkulima_trials", { method: "POST", body: { user_id: user.id, starts_at: now.toISOString(), ends_at: end.toISOString() }, prefer: "return=representation" });
      return json(200, { trial: created[0], alreadyStarted: false, message: "Your 72-hour Discovery Pass has started." });
    } catch (insertError) {
      // A concurrent click may have won the unique user_id insert. Return the
      // existing server-side trial rather than creating or extending another.
      const raced = await adminRest("mkulima_trials", { query: "?select=user_id,starts_at,ends_at&user_id=eq." + encodeURIComponent(user.id) + "&limit=1" });
      if (raced.length) return json(200, { trial: raced[0], alreadyStarted: true, message: "This account has already used its Discovery Pass." });
      throw insertError;
    }
  } catch (e) { return fail(e); }
};
