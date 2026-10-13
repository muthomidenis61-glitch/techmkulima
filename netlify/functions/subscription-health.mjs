import { json, preflight, requireUser, adminRest, supabaseAuth, env } from "./_shared.mjs";

const requiredEnv = [
  "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
  "SITE_URL", "DARAJA_CONSUMER_KEY", "DARAJA_CONSUMER_SECRET",
  "DARAJA_SHORTCODE", "DARAJA_PASSKEY", "DARAJA_CALLBACK_URL"
];
const safeCheck = (name, ok, detail) => ({ name, status: ok ? "pass" : "fail", detail });

export default async event => {
  const pf = preflight(event); if (pf) return pf;
  if (event.httpMethod !== "GET") return json(405, { error: "Use GET." });
  try {
    const user = await requireUser(event);
    const checks = [];
    const missing = requiredEnv.filter(name => !process.env[name]);
    checks.push(safeCheck("Protected environment settings", missing.length === 0,
      missing.length ? "Missing settings: " + missing.join(", ") : "All required subscription server variables are present; secret values are not displayed."));
    checks.push(safeCheck("AI farm assistant provider", Boolean(process.env.OPENAI_API_KEY),
      process.env.OPENAI_API_KEY ? "AI provider key is present; this check does not send a billable AI request." : "Missing OPENAI_API_KEY. Add it to protected Netlify environment variables to enable real AI text/photo guidance."));
    try {
      await supabaseAuth("/auth/v1/settings");
      checks.push(safeCheck("Supabase Auth", true, "Supabase Auth responded successfully."));
    } catch {
      checks.push(safeCheck("Supabase Auth", false, "Supabase Auth could not be reached with the configured URL and anon key."));
    }
    const tables = [
      ["Trials table", "mkulima_trials", "?select=user_id&limit=1"],
      ["Payments table", "mkulima_payments", "?select=id&limit=1"],
      ["Subscriptions table", "mkulima_subscriptions", "?select=user_id&limit=1"],
      ["Cloud farm records table", "mkulima_farm_records", "?select=id&limit=1"]
    ];
    for (const [name, table, query] of tables) {
      try {
        await adminRest(table, { query });
        checks.push(safeCheck(name, true, "Database table is reachable using the server role."));
      } catch {
        checks.push(safeCheck(name, false, "Table is missing or unavailable to the server role. Apply the latest Supabase SQL and check service-role configuration."));
      }
    }
    try {
      await adminRest("rpc/finalize_mkulima_payment", {
        method: "POST",
        body: { p_checkout_request_id: "MKULIMA_DIAGNOSTIC_NO_SUCH_PAYMENT", p_receipt: "DIAGNOSTIC_ONLY", p_paid_at: new Date().toISOString() },
        prefer: "return=representation"
      });
      checks.push(safeCheck("Payment finalisation RPC", false, "RPC returned unexpectedly for a nonexistent diagnostic payment; inspect the SQL function before accepting payments."));
    } catch (error) {
      const msg = String(error?.message || "");
      const exists = /Payment request not found/i.test(msg);
      checks.push(safeCheck("Payment finalisation RPC", exists, exists
        ? "RPC exists and rejected a nonexistent payment as expected; no payment or subscription was created."
        : "RPC could not be confirmed. Re-run the latest Supabase SQL and inspect the function permissions."));
    }
    let darajaOk = false, darajaDetail = "Daraja credentials are missing or could not be validated.";
    try {
      const names = ["DARAJA_CONSUMER_KEY", "DARAJA_CONSUMER_SECRET", "DARAJA_SHORTCODE", "DARAJA_PASSKEY"];
      if (names.every(n => process.env[n])) {
        const mode = (process.env.DARAJA_ENV || "sandbox").toLowerCase();
        const host = mode === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
        const basic = Buffer.from(env("DARAJA_CONSUMER_KEY") + ":" + env("DARAJA_CONSUMER_SECRET")).toString("base64");
        const response = await fetch(host + "/oauth/v1/generate?grant_type=client_credentials", {
          headers: { Authorization: "Basic " + basic },
          signal: AbortSignal.timeout(10000)
        });
        const data = await response.json().catch(() => ({}));
        darajaOk = response.ok && Boolean(data.access_token);
        darajaDetail = darajaOk
          ? "Safaricom Daraja OAuth succeeded in " + (mode === "production" ? "production" : "sandbox") + " mode. This test does not initiate a charge."
          : "Safaricom Daraja OAuth failed. Check environment mode and shortcode-specific app credentials in protected Netlify settings.";
      }
    } catch {
      darajaDetail = "Safaricom Daraja could not be reached or credentials could not be validated.";
    }
    checks.push(safeCheck("Safaricom Daraja OAuth", darajaOk, darajaDetail));
    const callback = process.env.DARAJA_CALLBACK_URL || "";
    checks.push(safeCheck("Public HTTPS callback URL", callback.startsWith("https://") && callback.includes("/.netlify/functions/mpesa-callback"),
      callback.startsWith("https://") && callback.includes("/.netlify/functions/mpesa-callback")
        ? "Callback URL has the expected HTTPS Netlify function shape."
        : "Set DARAJA_CALLBACK_URL to the deployed HTTPS /.netlify/functions/mpesa-callback endpoint."));
    const failed = checks.filter(c => c.status !== "pass").length;
    return json(200, {
      ok: failed === 0,
      summary: failed === 0 ? "All available integration checks passed. A real sandbox payment still needs a controlled end-to-end test." : failed + " integration check(s) need attention.",
      checkedAt: new Date().toISOString(),
      account: user.email,
      mode: (process.env.DARAJA_ENV || "sandbox").toLowerCase() === "production" ? "production" : "sandbox",
      checks
    });
  } catch (error) {
    const msg = String(error?.message || "");
    const statusCode = error?.statusCode || (/sign in|session|invalid credentials/i.test(msg) ? 401 : /configuration is missing/i.test(msg) ? 503 : 400);
    return json(statusCode, { error: statusCode === 503 ? "Subscription service configuration is incomplete." : msg });
  }
};
