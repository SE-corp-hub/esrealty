-- Pre-selling financing fields + payment schedule storage + schedule generator.
-- Run AFTER preselling.sql. Idempotent.

begin;

-- ── Financing inputs per unit ────────────────────────────────────────
alter table public.presell_units
  add column if not exists total_contract_price numeric(14, 2),
  add column if not exists reservation_fee      numeric(14, 2) default 0,
  add column if not exists downpayment_months   integer        default 24,
  add column if not exists loan_percent         numeric(5, 2)  default 90,
  add column if not exists loan_rate_annual     numeric(5, 2)  default 7.5,
  add column if not exists loan_term_years      integer        default 15,
  add column if not exists loan_start_date      date;

-- ── Payment schedule rows ────────────────────────────────────────────
create table if not exists public.presell_payments (
  id        uuid primary key default gen_random_uuid(),
  unit_id   uuid not null references public.presell_units(id) on delete cascade,
  due_date  date not null,
  label     text not null default '',
  amount    numeric(14, 2) not null default 0 check (amount >= 0),
  status    text not null default 'pending'
    check (status in ('paid', 'pending', 'late', 'waived')),
  paid_at   date,
  method    text not null default '',
  notes     text not null default '',
  created_at timestamptz not null default now(),
  unique (unit_id, due_date, label)
);

create index if not exists presell_payments_unit_due_idx
  on public.presell_payments (unit_id, due_date);

alter table public.presell_payments enable row level security;

drop policy if exists "presell payments read auth" on public.presell_payments;
create policy "presell payments read auth" on public.presell_payments
  for select using (auth.role() = 'authenticated');

drop policy if exists "presell payments admin write" on public.presell_payments;
create policy "presell payments admin write" on public.presell_payments
  for all using (public.is_super_admin())
  with check (public.is_super_admin());

-- ── Generator: builds pending schedule, preserving payment history ───
create or replace function public.generate_presell_schedule(p_unit uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  u record;
  tcp numeric;
  eq_total numeric;
  eq_monthly numeric;
  principal numeric;
  r numeric := 0;
  m int;
  amort numeric;
  d date;
  i int;
  created int := 0;
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin access required';
  end if;

  select * into u from public.presell_units where id = p_unit;
  if not found then raise exception 'Unit not found'; end if;

  tcp := coalesce(nullif(u.total_contract_price, 0), u.price, 0);
  if tcp <= 0 then raise exception 'Set the total contract price first'; end if;

  -- keep history; drop only untouched pending rows
  delete from public.presell_payments where unit_id = p_unit and status = 'pending';

  -- reservation fee
  if not exists (
    select 1 from public.presell_payments
    where unit_id = p_unit and lower(coalesce(label, '')) like 'reservation%'
  ) then
    insert into public.presell_payments (unit_id, due_date, label, amount, status)
    values (p_unit, coalesce(u.reserved_at::date, current_date), 'Reservation Fee',
            coalesce(u.reservation_fee, 0), 'paid');
    created := created + 1;
  end if;

  -- equity months (interest-free spread)
  eq_total  := tcp * (100 - coalesce(u.loan_percent, 90)) / 100;
  eq_monthly := round(eq_total / greatest(coalesce(u.downpayment_months, 24), 1), 2);
  d := (coalesce(u.reserved_at::date, current_date) + interval '1 month')::date;
  for i in 1..greatest(coalesce(u.downpayment_months, 24), 1) loop
    if not exists (
      select 1 from public.presell_payments
      where unit_id = p_unit and lower(coalesce(label, '')) = 'equity ' || i
    ) then
      insert into public.presell_payments (unit_id, due_date, label, amount, status)
      values (p_unit, d, 'Equity ' || i || ' of ' || greatest(u.downpayment_months, 1), eq_monthly, 'pending');
      created := created + 1;
    end if;
    d := (d + interval '1 month')::date;
  end loop;

  -- bank take-out amortization
  m := least(greatest(coalesce(u.loan_term_years, 0), 0) * 12, 360);
  if coalesce(u.loan_percent, 0) > 0 and u.loan_start_date is not null and m > 0 then
    principal := tcp * coalesce(u.loan_percent, 90) / 100;
    r := coalesce(u.loan_rate_annual, 7.5) / 100 / 12;
    amort := round(principal * r / (1 - power(1 + r, -m)), 2);
    d := u.loan_start_date;
    for i in 1..m loop
      if not exists (
        select 1 from public.presell_payments
        where unit_id = p_unit and lower(coalesce(label, '')) = 'amortization ' || i
      ) then
        insert into public.presell_payments (unit_id, due_date, label, amount, status)
        values (p_unit, d, 'Amortization ' || i || ' of ' || m, amort, 'pending');
        created := created + 1;
      end if;
      d := (d + interval '1 month')::date;
    end loop;
  end if;

  return created;
end;
$$;

revoke all on function public.generate_presell_schedule(uuid) from public, anon;
grant execute on function public.generate_presell_schedule(uuid) to authenticated;

commit;
