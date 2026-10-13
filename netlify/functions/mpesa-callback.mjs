import { json, adminRest, env } from "./_shared.mjs";
function stamp(d = new Date()) { return d.getFullYear() + String(d.getMonth()+1).padStart(2,"0") + String(d.getDate()).padStart(2,"0") + String(d.getHours()).padStart(2,"0") + String(d.getMinutes()).padStart(2,"0") + String(d.getSeconds()).padStart(2,"0"); }
async function querySafaricom(checkoutRequestId) {
  const envName = (process.env.DARAJA_ENV || "sandbox").toLowerCase();
  const host = envName === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
  const shortcode = env("DARAJA_SHORTCODE"), passkey = env("DARAJA_PASSKEY");
  const basic = Buffer.from(env("DARAJA_CONSUMER_KEY") + ":" + env("DARAJA_CONSUMER_SECRET")).toString("base64");
  const tr = await fetch(host + "/oauth/v1/generate?grant_type=client_credentials", { headers: { Authorization: "Basic " + basic } });
  const td = await tr.json(); if (!tr.ok || !td.access_token) throw new Error("Could not authenticate with Safaricom for transaction verification.");
  const timestamp = stamp(), password = Buffer.from(shortcode + passkey + timestamp).toString("base64");
  const qr = await fetch(host + "/mpesa/stkpushquery/v1/query", { method:"POST", headers:{Authorization:"Bearer "+td.access_token,"Content-Type":"application/json"}, body:JSON.stringify({BusinessShortCode:shortcode,Password:password,Timestamp:timestamp,CheckoutRequestID:checkoutRequestId}) });
  const qd = await qr.json();
  if (!qr.ok) throw new Error(qd.errorMessage || "Safaricom transaction verification failed.");
  return qd;
}
export default async event => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };
  try {
    const b = JSON.parse(event.body || "{}"), stk = b?.Body?.stkCallback;
    if (!stk?.CheckoutRequestID) return { statusCode: 200, body: JSON.stringify({ ResultCode: 0, ResultDesc: "Callback received" }) };
    const matches = await adminRest("mkulima_payments", { query: "?select=id,user_id,plan,amount_kes,phone,status,checkout_request_id&checkout_request_id=eq." + encodeURIComponent(stk.CheckoutRequestID) + "&limit=1" });
    const payment = matches[0];
    if (!payment) return { statusCode: 200, body: JSON.stringify({ ResultCode: 0, ResultDesc: "Unmatched callback ignored" }) };
    if (payment.status === "paid" || payment.status === "failed") return { statusCode: 200, body: JSON.stringify({ ResultCode: 0, ResultDesc: "Already processed" }) };
    if (Number(stk.ResultCode) !== 0) {
      await adminRest("mkulima_payments", { method:"PATCH", query:"?checkout_request_id=eq."+encodeURIComponent(payment.checkout_request_id)+"&status=eq.pending", body:{status:"failed",result_description:String(stk.ResultDesc || "Payment not completed").slice(0,240),updated_at:new Date().toISOString()}, prefer:"return=minimal" });
      return { statusCode: 200, headers:{"Content-Type":"application/json"}, body:JSON.stringify({ResultCode:0,ResultDesc:"Payment failure recorded"}) };
    }
    // Safaricom STK query confirms the server-side transaction outcome. Amount,
    // phone and receipt are taken from the corresponding callback metadata.
    const query = await querySafaricom(stk.CheckoutRequestID);
    const verified = String(query.ResultCode) === "0" && String(query.CheckoutRequestID) === String(payment.checkout_request_id);
    if (!verified) return { statusCode: 200, headers:{"Content-Type":"application/json"}, body:JSON.stringify({ResultCode:0,ResultDesc:"Received; payment not activated without verification"}) };
    const items = stk.CallbackMetadata?.Item || [];
    const meta = Object.fromEntries(items.map(i=>[i.Name,i.Value]));
    if (!meta.MpesaReceiptNumber || Number(meta.Amount) !== Number(payment.amount_kes) || String(meta.PhoneNumber) !== String(payment.phone)) {
      await adminRest("mkulima_payments", {method:"PATCH",query:"?checkout_request_id=eq."+encodeURIComponent(payment.checkout_request_id)+"&status=eq.pending",body:{status:"review",result_description:"Safaricom details require reconciliation",updated_at:new Date().toISOString()},prefer:"return=minimal"});
      return { statusCode:200,headers:{"Content-Type":"application/json"},body:JSON.stringify({ResultCode:0,ResultDesc:"Payment requires reconciliation"}) };
    }
    // The SQL RPC finalises the payment and subscription atomically. It locks
    // the payment row, prevents duplicate callback grants, and preserves time
    // remaining when a customer renews early. It sets status:"paid" only after
    // the verified receipt has passed amount, phone and Safaricom query checks.
    await adminRest("rpc/finalize_mkulima_payment", {
      method: "POST",
      body: {
        p_checkout_request_id: payment.checkout_request_id,
        p_receipt: String(meta.MpesaReceiptNumber),
        p_paid_at: new Date().toISOString()
      },
      prefer: "return=representation"
    });
    return {statusCode:200,headers:{"Content-Type":"application/json"},body:JSON.stringify({ResultCode:0,ResultDesc:"Verified and processed"})};
  } catch (e) {
    // Never acknowledge a failed database write as a successful subscription.
    return { statusCode: 500, headers:{"Content-Type":"application/json"}, body:JSON.stringify({error:"Callback processing failed; no unverified access was granted."}) };
  }
};
