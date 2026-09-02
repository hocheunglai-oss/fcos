-- Cover the remaining Master Contract foreign-key lookup paths identified by
-- the post-migration Supabase advisor. These are intentionally separate from
-- the workflow migration so the production repair remains immutable/auditable.

create index if not exists master_contract_links_delivery_idx
  on public.master_contract_salesforce_links(delivery_id);

create index if not exists master_contract_sync_contract_idx
  on public.master_contract_sync_jobs(contract_id);

create index if not exists master_contract_variances_delivery_idx
  on public.master_contract_variances(delivery_id);
