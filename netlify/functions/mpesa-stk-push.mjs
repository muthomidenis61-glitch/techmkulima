import { json, preflight, readBody, requireUser, adminRest, env, normalizeKenyanPhone, fail } from "./_shared.mjs";
const plans = { Weekly: { amount: 300, days: 7 }, Monthly: { amount: 1050, days: 30 } };
function stamp(d = new Date()) { return d.getFullYear() + String(d.getMonth()+1).padStart(2,"0") + String(d.getDate()).padStart(2,"0") + String(d.getHours()).padStart(2,"0") + String(d.getMinutes()).padStart(2,"0") + String(d.getSeconds()).padStart(2,"0"); }
export default async event => {
  const pf = preflight(event); if (pf) return pf;
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST." });
  try {
    const user = await requireUser(event), b = await readBody(event), plan = plans[b.plan];
    if (!plan) throw new Error("Choose Weekly (KSh 300) or Monthly (KSh 1,050).");
    // Enforce the duplicate-prompt guard on the server; browser checks alone can be bypassed.
    const pendingSince = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const pending = await adminRest("mkulima_payments", { query: "?select=checkout_request_id,created_at&user_id=eq." + encodeURIComponent(user.id) + "&status=eq.pending&created_at=gte." + encodeURIComponent(pendingSince) + "&order=created_at.desc&limit=1" });
    if (pending.length) throw new Error("You already have an M-Pesa request in progress. Wait a few minutes, then refresh subscription status before trying again.");
    const phone = normalizeKenyanPhone(b.phone);
    const envName = (process.env.DARAJA_ENV || "sandbox").toLowerCase();
    const host = envName === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
    const shortcode = env("DARAJA_SHORTCODE"), passkey = env("DARAJA_PASSKEY");
    const consumerKey = env("DARAJA_CONSUMER_KEY"), consumerSecret = env("DARAJA_CONSUMER_SECRET");
    const callbackUrl = env("DARAJA_CALLBACK_URL");
    if (!callbackUrl.startsWith("https://")) throw new Error("DARAJA_CALLBACK_URL must be a public HTTPS Netlify function URL.");
    const basic = Buffer.from(consumerKey + ":" + consumerSecret).toString("base64");
    const tokenResponse = await fetch(host + "/oauth/v1/generate?grant_type=client_credentials", { headers: { Authorization: "Basic " + basic } });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error("Safaricom Daraja authentication failed. Check server credentials and environment.");
    const timestamp = stamp(), password = Buffer.from(shortcode + passkey + timestamp).toString("base64");
    const response = await fetch(host + "/mpesa/stkpush/v1/processrequest", { method: "POST", headers: { Authorization: "Bearer " + tokenData.access_token, "Content-Type": "application/json" }, body: JSON.stringify({
      BusinessShortCode: shortcode, Password: password, Timestamp: timestamp, TransactionType: "CustomerPayBillOnline",
      Amount: plan.amount, PartyA: phone, PartyB: shortcode, PhoneNumber: phone, CallBackURL: callbackUrl,
      AccountReference: "MKULIMA", TransactionDesc: "MKULIMA " + b.plan + " subscription"
    }) });
    const result = await response.json();
    if (!response.ok || result.ResponseCode !== "0" || !result.CheckoutRequestID) throw new Error(result.errorMessage || result.ResponseDescription || "Safaricom could not start the M-Pesa prompt.");
    await adminRest("mkulima_payments", { method: "POST", body: {
      user_id: user.id, plan: b.plan, amount_kes: plan.amount, phone, checkout_request_id: result.CheckoutRequestID,
      merchant_request_id: result.MerchantRequestID || null, status: "pending", created_at: new Date().toISOString()
    }, prefer: "return=minimal" });
    return json(200, { ok: true, status: "pending", message: "M-Pesa request sent. Check your phone and enter your M-Pesa PIN only in the official Safaricom prompt. Access activates only after server-side confirmation.", checkoutRequestId: result.CheckoutRequestID });
  } catch (e) { return fail(e); }
};
