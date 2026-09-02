create index if not exists hedge_physical_salesforce_costs_created_by_idx
  on public.hedge_physical_salesforce_costs (created_by);

create index if not exists hedge_physical_salesforce_costs_updated_by_idx
  on public.hedge_physical_salesforce_costs (updated_by);

create index if not exists hedge_physical_salesforce_costs_synced_by_idx
  on public.hedge_physical_salesforce_costs (synced_by);

create index if not exists hedge_physical_salesforce_cost_history_actor_idx
  on public.hedge_physical_salesforce_cost_history (actor_user_id);
