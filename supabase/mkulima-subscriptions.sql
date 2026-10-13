-- Run this SQL in the Supabase SQL Editor before enabling MKULIMA subscriptions.
-- All rows are private to the server-side service role. Never expose the service role key in the browser.
create extension if not exists pgcrypto;

create table if not exists public.mkulima_trials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint mkulima_trial_duration check (ends_at > starts_at)
);

create table if not exists public.mkulima_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null check (plan in ('Weekly','Monthly')),
  amount_kes integer not null check (amount_kes in (300,1050)),
  phone text not null,
  checkout_request_id text not null unique,
  merchant_request_id text,
  status text not null default 'pending' check (status in ('pending','paid','failed','review')),
  mpesa_receipt text,
  result_description text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.mkulima_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null check (plan in ('Weekly','Monthly')),
  status text not null check (status in ('active','expired','cancelled')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  mpesa_receipt text,
  updated_at timestamptz not null default now(),
  constraint mkulima_subscription_period check (ends_at > starts_at)
);

alter table public.mkulima_trials enable row level security;
alter table public.mkulima_payments enable row level security;
alter table public.mkulima_subscriptions enable row level security;
-- No client policies are created intentionally. Only Netlify server functions using
-- SUPABASE_SERVICE_ROLE_KEY access these tables. Keep that key server-side.
revoke all on public.mkulima_trials from anon, authenticated;
revoke all on public.mkulima_payments from anon, authenticated;
revoke all on public.mkulima_subscriptions from anon, authenticated;
grant all on public.mkulima_trials to service_role;
grant all on public.mkulima_payments to service_role;
grant all on public.mkulima_subscriptions to service_role;


-- Server-side, account-scoped cloud farm records for subscribed users.
-- Only Netlify functions using the service role may read/write these records.
create table if not exists public.mkulima_farm_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_type text not null check (record_type in ('farm_note','crop_record','livestock_record','expense','sale','inventory')),
  title text not null check (char_length(title) between 1 and 120),
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 65536),
  client_record_id text check (client_record_id is null or char_length(client_record_id) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.mkulima_farm_records add column if not exists client_record_id text;
create unique index if not exists mkulima_farm_records_client_id_unique
  on public.mkulima_farm_records (user_id, client_record_id);
create index if not exists mkulima_farm_records_user_updated_idx
  on public.mkulima_farm_records (user_id, updated_at desc);
alter table public.mkulima_farm_records enable row level security;
revoke all on public.mkulima_farm_records from anon, authenticated;
grant all on public.mkulima_farm_records to service_role;

-- Finalise a verified M-Pesa payment and grant access in one database transaction.
-- Row locking makes duplicate/concurrent callbacks idempotent, and early renewals
-- preserve the unused time on an existing active subscription.
create or replace function public.finalize_mkulima_payment(
  p_checkout_request_id text,
  p_receipt text,
  p_paid_at timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  payment_row public.mkulima_payments%rowtype;
  existing_end timestamptz;
  subscription_start timestamptz;
  subscription_end timestamptz;
  duration_days integer;
begin
  select * into payment_row
  from public.mkulima_payments
  where checkout_request_id = p_checkout_request_id
  for update;

  if not found then
    raise exception 'Payment request not found';
  end if;

  if payment_row.status = 'paid' then
    return jsonb_build_object('ok', true, 'alreadyProcessed', true);
  end if;

  if payment_row.status <> 'pending' then
    raise exception 'Payment is not pending';
  end if;

  if nullif(trim(p_receipt), '') is null then
    raise exception 'Verified payment receipt is required';
  end if;

  duration_days := case payment_row.plan when 'Weekly' then 7 when 'Monthly' then 30 else null end;
  if duration_days is null then
    raise exception 'Unsupported subscription plan';
  end if;

  select ends_at into existing_end
  from public.mkulima_subscriptions
  where user_id = payment_row.user_id
    and status = 'active'
    and ends_at > p_paid_at
  for update;

  subscription_start := greatest(p_paid_at, coalesce(existing_end, p_paid_at));
  subscription_end := subscription_start + make_interval(days => duration_days);

  insert into public.mkulima_subscriptions
    (user_id, plan, status, starts_at, ends_at, mpesa_receipt, updated_at)
  values
    (payment_row.user_id, payment_row.plan, 'active', subscription_start,
     subscription_end, p_receipt, now())
  on conflict (user_id) do update set
    plan = excluded.plan,
    status = 'active',
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    mpesa_receipt = excluded.mpesa_receipt,
    updated_at = now();

  update public.mkulima_payments
  set status = 'paid',
      mpesa_receipt = p_receipt,
      result_description = 'Safaricom transaction verified',
      paid_at = p_paid_at,
      updated_at = now()
  where id = payment_row.id and status = 'pending';

  return jsonb_build_object(
    'ok', true,
    'alreadyProcessed', false,
    'startsAt', subscription_start,
    'endsAt', subscription_end
  );
end;
$$;

revoke all on function public.finalize_mkulima_payment(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.finalize_mkulima_payment(text, text, timestamptz) to service_role;
