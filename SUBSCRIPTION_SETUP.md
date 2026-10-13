# MKULIMA genuine subscription setup

The code in this change adds account registration/login, a server-timed one-use 72-hour Discovery Pass, M-Pesa STK Push initiation, a Safaricom STK query check, and subscription entitlements stored in Supabase. It deliberately fails closed until provider configuration is complete.

## 1. Supabase
1. Create/open the project in the official Supabase dashboard.
2. In SQL Editor, run the complete, latest file `supabase/mkulima-subscriptions.sql`. **This is required after the latest code change** because the M-Pesa callback now calls the database function `public.finalize_mkulima_payment(...)`. If you ran an older version of this SQL previously, run the entire updated file again; it uses `create or replace function` for the new function.
3. In Authentication settings, configure email confirmation and the production site URL/redirect URLs. For a first test, use a test account you control.
4. Copy the project URL and publishable/anon key from the project API settings. The service-role key must stay private.

## 2. Netlify environment variables
In the MKULIMA Netlify site's environment variables, set these for Functions (Production and Deploy Previews as appropriate):
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (secret; server only)
- `SITE_URL=https://mkulim.netlify.app`
- `DARAJA_ENV=sandbox` while testing
- `DARAJA_CONSUMER_KEY` (secret)
- `DARAJA_CONSUMER_SECRET` (secret)
- `DARAJA_SHORTCODE` (must be the shortcode enabled for STK Push on the Daraja application)
- `DARAJA_PASSKEY` (secret supplied for that shortcode)
- `DARAJA_CALLBACK_URL=https://mkulim.netlify.app/.netlify/functions/mpesa-callback`
- `OPENAI_API_KEY` (secret; required for the real text/photo AI farm assistant)
- `OPENAI_MODEL=gpt-4.1-mini` (optional; choose a vision-capable model available to your OpenAI project)

Never paste these secrets into ChatGPT, source code, GitHub issues, or a public repository. Add/update them only in Netlify's protected environment settings. The listed PayBill number on the existing instructions page is not automatically guaranteed to be an STK-enabled shortcode: confirm with Safaricom/Daraja that the business shortcode and passkey belong to the legitimate payee.

## 3. Safe test sequence
1. Keep `DARAJA_ENV=sandbox` and use Safaricom's sandbox test credentials and test numbers.
2. Deploy the functions after setting the Supabase schema and required variables.
3. Register a test user, confirm email if required, and sign in at `/subscription.html`.
4. Start a Discovery Pass; verify a single row in `mkulima_trials`, then try again and confirm the original expiry is returned.
5. Start a sandbox STK request; verify pending payment is not active. Exercise successful, cancelled, wrong-amount and duplicate callback cases. A subscription is granted only after the server-side STK query and amount/phone/receipt checks pass and the SQL finalisation function completes.
6. Only after end-to-end sandbox tests and payee ownership confirmation, switch Daraja to production and set production credentials. Do not collect a user's M-Pesa PIN on MKULIMA.

## Server-side premium enforcement contract
A reusable `requireActiveAccess(event)` guard now lives in `netlify/functions/_shared.mjs`. Every Netlify function that performs a premium-only action must call and await this guard before reading or changing protected data, for example `const { user, access } = await requireActiveAccess(event);`. It verifies the bearer session against Supabase Auth and checks the current paid subscription or trial against server-side database timestamps; it returns HTTP 403 when access is inactive and fails closed if the database/configuration cannot be checked. Never trust a plan name, receipt, phone number, user ID, or `access.active` value supplied by the browser.

This guard strengthens the backend foundation, but it does not magically restrict static HTML tools or browser-local features. A premium tool is enforced only after its sensitive operation is moved behind a Netlify function that invokes this guard. Do not advertise all tools as paywalled until each premium operation has been migrated and tested.

## How paid access activates
After a successful M-Pesa payment is confirmed by the server and `finalize_mkulima_payment` completes, the paid entitlement is attached to the signed-in MKULIMA account. The subscription page polls for confirmation and displays a **Subscription active — open farm tools** button as soon as the server reports active access; no separate SMS code is needed to claim the subscription. This avoids a second code-delivery dependency and prevents a receipt or guessed code from granting access. The user's M-Pesa PIN is entered only in the official Safaricom prompt.

An SMS receipt/notification is not currently sent by MKULIMA: that requires a separately configured SMS provider and credentials. The account's on-page activation is the current immediate confirmation path. The button is a navigation convenience, not proof that every static dashboard feature is access-controlled; enforce server-side entitlements for premium-only backend operations before claiming the whole site is paywalled.

## Premium-gated cloud farm records API
A first server-side premium service is available at `/.netlify/functions/farm-records`. It accepts authenticated requests only, calls `requireActiveAccess(event)` before database access, and scopes every query to the authenticated user's Supabase ID. `GET` lists up to 100 of that account's records; `POST` creates a `farm_note`, `crop_record`, `livestock_record`, `expense`, `sale`, or `inventory` record. Titles are limited to 120 characters and each JSON data object is limited to 32 KB. The SQL table has row-level security enabled and no client access grants; only the server-side service role can access it.

Before using this endpoint, re-run the complete updated `supabase/mkulima-subscriptions.sql` in Supabase SQL Editor so the `mkulima_farm_records` table exists. The mobile UI integration is available at `/farmbook-cloud.html`. It reads the existing same-tab signed-in session, uploads local FarmBook records that are not already present in the cloud, and merges cloud records back into local storage without deleting existing local entries. Cloud sync requires an active paid subscription or Discovery Pass. The browser UI cannot override the server-side entitlement check. The API and UI still require an end-to-end test against your configured Netlify/Supabase deployment. Records now use a per-account unique client record ID for idempotent cloud backup; rerun the updated SQL to create the column and unique index. Do not store highly sensitive personal information in farm records.

## Real AI farm assistant (text and photo)

`/.netlify/functions/farm-ai` calls the OpenAI Responses API from the server. It requires a signed-in user with an active paid subscription or Discovery Pass, and the `OPENAI_API_KEY` server environment variable. The key must never be placed in HTML, browser JavaScript, GitHub, or a message. The assistant accepts a text question and optional compressed JPEG photo; it is designed to explain uncertainty, avoid prescribing medicines or chemical dosages, and escalate urgent animal-health signs. This is AI-generated first guidance, not a diagnosis. Set the key in protected Netlify environment variables, redeploy, and test with a controlled account before announcing it as available. Provider access, model availability, and usage charges depend on the OpenAI project.

## Current billing rules
- Weekly: KSh 300 for 7 days.
- Monthly: KSh 1,050 for 30 days.
- Payments are one-time; there is no automatic recurring charge. Users must renew manually.
- Cancellation, refunds, customer support process, terms and privacy notices should be finalised before public paid launch.
- The backend records paid entitlements, but it does not yet gate every tool in the main static dashboard. Add server-authorised API checks to any premium-only operation before representing feature restrictions as enforced.

## Endpoints
- `/.netlify/functions/auth-register`
- `/.netlify/functions/auth-login`
- `/.netlify/functions/subscription-trial`
- `/.netlify/functions/subscription-status`
- `/.netlify/functions/mpesa-stk-push`
- `/.netlify/functions/mpesa-callback`

Without the environment variables, Supabase SQL setup (including `finalize_mkulima_payment`), and valid Daraja credentials, the UI reports setup is incomplete; it must not claim a payment or paid plan is active. A successful GitHub Actions check validates code structure and syntax, but does not run live M-Pesa payments or apply SQL to your Supabase project.
