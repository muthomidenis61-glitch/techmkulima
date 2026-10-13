import { json, preflight, requireUser, adminRest, fail } from "./_shared.mjs";
export default async event => {
  const pf = preflight(event); if (pf) return pf;
  if (event.httpMethod !== "GET") return json(405, { error: "Use GET." });
  try {
    const user = await requireUser(event);
    const now = new Date().toISOString();
    const [subs, trials, payments] = await Promise.all([
      adminRest("mkulima_subscriptions", { query: "?select=plan,status,starts_at,ends_at,mpesa_receipt,updated_at&user_id=eq." + encodeURIComponent(user.id) + "&status=eq.active&ends_at=gt." + encodeURIComponent(now) + "&order=ends_at.desc&limit=1" }),
      adminRest("mkulima_trials", { query: "?select=starts_at,ends_at&user_id=eq." + encodeURIComponent(user.id) + "&limit=1" }),
      adminRest("mkulima_payments", { query: "?select=plan,amount_kes,status,mpesa_receipt,result_description,created_at,updated_at&user_id=eq." + encodeURIComponent(user.id) + "&order=created_at.desc&limit=1" })
    ]);
    const subscription = subs[0] || null;
    const trial = trials[0] || null;
    const serverMs = Date.parse(now);
    const paidActive = Boolean(subscription && Date.parse(subscription.ends_at) > serverMs);
    const trialActive = Boolean(trial && Date.parse(trial.ends_at) > serverMs);
    const access = paidActive
      ? { active: true, source: "paid", plan: subscription.plan, expiresAt: subscription.ends_at }
      : trialActive
        ? { active: true, source: "trial", plan: "Discovery Pass", expiresAt: trial.ends_at }
        : { active: false, source: "none", plan: null, expiresAt: null };
    return json(200, { user: { id: user.id, email: user.email, fullName: user.user_metadata?.full_name || "" }, subscription, trial, payment: payments[0] || null, access, serverTime: now, configured: true });
  } catch (e) { return fail(e); }
};
