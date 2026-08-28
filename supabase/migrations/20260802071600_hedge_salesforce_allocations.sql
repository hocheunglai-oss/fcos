create table if not exists public.hedge_salesforce_allocations (
  id uuid primary key default gen_random_uuid(),
  paper_hedge_id uuid not null references public.hedge_swap_hedges(id) on delete restrict,
  salesforce_stem_id text not null,
  stem_key_snapshot text not null,
  venue text not null check (venue in ('ICE', 'FCBS')),
  supplier_account_id text not null,
  supplier_name_snapshot text not null,
  salesforce_record_id text,
  salesforce_record_name text,
  salesforce_last_modified_at timestamptz,
  allocation_percentage numeric(9, 6) not null check (allocation_percentage >= 0 and allocation_percentage <= 100),
  gross_pnl numeric(18, 2) not null,
  fee_amount numeric(18, 2) not null check (fee_amount >= 0),
  net_pnl numeric(18, 2) not null,
  salesforce_cost numeric(18, 2) not null,
  calculation_snapshot jsonb not null default '{}'::jsonb,
  mapping_revision bigint not null default 1 check (mapping_revision > 0),
  sync_state text not null default 'ready'
    check (sync_state in ('ready', 'legacy_adopted', 'synced', 'stale', 'missing', 'ambiguous', 'failed', 'uncertain')),
  review_issue text,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_by_email text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_by_email text,
  synced_at timestamptz,
  synced_by uuid references public.user_profiles(id) on delete set null,
  synced_by_email text,
  unique (paper_hedge_id, salesforce_stem_id),
  check (salesforce_stem_id ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'),
  check (supplier_account_id ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'),
  check (salesforce_record_id is null or salesforce_record_id ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$')
);

create index if not exists hedge_salesforce_allocations_record_idx
  on public.hedge_salesforce_allocations(salesforce_record_id)
  where salesforce_record_id is not null;

create index if not exists hedge_salesforce_allocations_state_idx
  on public.hedge_salesforce_allocations(sync_state, updated_at desc);

alter table public.hedge_salesforce_allocations enable row level security;
revoke all on table public.hedge_salesforce_allocations from public, anon, authenticated;
grant all on table public.hedge_salesforce_allocations to service_role;

insert into public.hedge_settings (key, value, label, notes, created_by)
values (
  'salesforce_mapping',
  jsonb_build_object(
    'mappingRevision', 1,
    'objectName', 'STEM_Extra_Cost__c',
    'stemObjectName', 'STEM__c',
    'stemNameField', 'KeyStem__c',
    'stemLookupField', 'STEM__c',
    'amountField', 'Lumpsum_Cost__c',
    'descriptionField', 'Description__c',
    'productLookupField', 'Product2Id__c',
    'supplierLookupField', 'Supplier__c',
    'fixedField', 'Fixed__c',
    'quantityField', 'Quantity_Delivered_Per_BDN__c',
    'paymentTermField', 'Payment_Term__c',
    'recordTypeId', '0122x000000cwlgAAA',
    'productId', '01tfu000002zAEDAA2',
    'quantity', 1,
    'venues', jsonb_build_object(
      'ICE', jsonb_build_object(
        'supplierId', '001fu00000Zo8eHAAR',
        'paymentTerm', '7 I'
      ),
      'FCBS', jsonb_build_object(
        'supplierId', '0012x00000LGhzUAAT',
        'paymentTerm', '7 I'
      )
    )
  ),
  'Validated Salesforce SWAPS allocation mapping',
  'Salesforce IDs are validated against live describe and record metadata before use.',
  'system'
)
on conflict (key) do nothing;
