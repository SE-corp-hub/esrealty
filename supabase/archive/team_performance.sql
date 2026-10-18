-- Team Performance analytics: per-agent lead funnel, deal counts, volume.
-- Run AFTER schema.sql, crm_leads.sql, broker_transactions.sql, shared_listings.sql.
-- Access: Super Admin -> all brokers/agents. Broker -> self + supervised agents.
-- NOTE: all relations are schema-qualified because search_path is pinned empty.

begin;

create or replace function public.team_performance()
returns table (
  user_id uuid,
  full_name text,
  role text,
  leads_total bigint,
  leads_open bigint,
  leads_closed bigint,
  deals_closed bigint,
  sales_volume numeric,
  listings_active bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id                                          as user_id,
    p.full_name                                   as full_name,
    p.role::text                                  as role,
    (select count(*) from public.crm_leads l
       where l.assigned_to_id = p.id)             as leads_total,
    (select count(*) from public.crm_leads l
       where l.assigned_to_id = p.id
         and coalesce(l.payload ->> 'status', 'new') not in ('lost', 'closed'))
                                                  as leads_open,
    (select count(*) from public.crm_leads l
       where l.assigned_to_id = p.id
         and l.payload ->> 'status' = 'closed')   as leads_closed,
    (select count(*) from public.broker_transactions t
       where t.created_by = p.id
         and coalesce(t.payload ->> 'stage', '') = 'done')
                                                  as deals_closed,
    (select coalesce(sum(nullif(t.payload ->> 'price', '')::numeric), 0)
       from public.broker_transactions t
       where t.created_by = p.id
         and coalesce(t.payload ->> 'stage', '') = 'done')
                                                  as sales_volume,
    (select count(*) from public.shared_listings s
       where s.owner_id = p.id
         and s.is_published
         and s.status = 'available')              as listings_active
  from public.profiles p
  where p.role in ('broker', 'agent')
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.profiles me
        where me.id = auth.uid()
          and me.role = 'broker'
          and p.broker = me.id
      )
      or p.id = auth.uid()
    )
  order by sales_volume desc;
$$;

revoke all on function public.team_performance() from public, anon;
grant execute on function public.team_performance() to authenticated;

commit;
