drop table if exists public.disputes;

create table if not exists public.dispute_workflow_parties (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.dispute_beta_cases(id) on delete cascade,
  stem_id text not null,
  account_id text not null,
  account_key text not null,
  account_name text not null default '',
  roles text[] not null default '{}'::text[],
  source_types text[] not null default '{}'::text[],
  source_record_ids text[] not null default '{}'::text[],
  payment_terms text[] not null default '{}'::text[],
  products text[] not null default '{}'::text[],
  cancelled_source_only boolean not null default false,
  created_by uuid null references public.user_profiles(id) on delete set null,
  created_by_email text null,
  updated_by uuid null references public.user_profiles(id) on delete set null,
  updated_by_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dispute_workflow_parties_account_id_check
    check (account_id ~ '^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$'),
  constraint dispute_workflow_parties_account_key_check
    check (account_key ~ '^[a-zA-Z0-9]{15}$' and account_key = left(account_id, 15)),
  constraint dispute_workflow_parties_roles_check
    check (cardinality(roles) > 0 and roles <@ array['buyer', 'supplier']::text[]),
  constraint dispute_workflow_parties_sources_check
    check (cardinality(source_types) > 0 and source_types <@ array['stem_buyer', 'line_item', 'extra_cost']::text[]),
  unique (case_id, account_key),
  unique (id, case_id)
);

create index if not exists dispute_workflow_parties_stem_idx
on public.dispute_workflow_parties(stem_id, account_key);

create index if not exists dispute_workflow_parties_case_idx
on public.dispute_workflow_parties(case_id, created_at);

alter table public.dispute_workflow_parties enable row level security;
revoke all on table public.dispute_workflow_parties from anon, authenticated;
grant all on table public.dispute_workflow_parties to service_role;

alter table public.dispute_beta_actions
  add column if not exists party_id uuid null,
  add column if not exists party_side text null;

alter table public.dispute_beta_actions
  add constraint dispute_beta_actions_party_id_fkey
    foreign key (party_id, case_id)
    references public.dispute_workflow_parties(id, case_id)
    on delete restrict,
  add constraint dispute_beta_actions_party_side_check
    check (party_side in ('buyer', 'supplier'));

alter table public.dispute_beta_actions
  alter column party_type set default 'supplier';

create unique index dispute_beta_actions_case_party_side_uidx
on public.dispute_beta_actions(case_id, party_id, party_side);

create index dispute_beta_actions_party_idx
on public.dispute_beta_actions(party_id, created_at);

alter table public.dispute_workflow_documents
  add column if not exists party_id uuid null,
  add column if not exists party_side text null,
  add column if not exists document_direction text null,
  add column if not exists requested_filename text not null default '',
  add column if not exists upload_status text not null default 'pending';

alter table public.dispute_workflow_documents
  add constraint dispute_workflow_documents_party_id_fkey
    foreign key (party_id, case_id)
    references public.dispute_workflow_parties(id, case_id)
    on delete restrict,
  add constraint dispute_workflow_documents_party_side_check
    check (party_side in ('buyer', 'supplier')),
  add constraint dispute_workflow_documents_direction_check
    check (document_direction in ('from_supplier', 'to_supplier', 'from_buyer', 'to_buyer')),
  add constraint dispute_workflow_documents_upload_status_check
    check (upload_status in ('pending', 'complete'));

alter table public.dispute_workflow_documents
  alter column salesforce_content_version_id drop not null,
  alter column party_type set default 'supplier';

create index dispute_workflow_documents_party_idx
on public.dispute_workflow_documents(party_id, created_at desc);

create unique index dispute_workflow_documents_stem_filename_uidx
on public.dispute_workflow_documents(stem_id, lower(smart_filename));

create or replace function public.save_dispute_workflow_draft(
  p_case jsonb,
  p_parties jsonb,
  p_actions jsonb,
  p_actor jsonb,
  p_event_note text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_case_id uuid;
  v_actor_id uuid := nullif(p_actor->>'id', '')::uuid;
  v_actor_email text := nullif(p_actor->>'email', '');
  v_party jsonb;
  v_action jsonb;
  v_party_id uuid;
  v_action_id uuid;
begin
  if jsonb_typeof(p_parties) <> 'array' or jsonb_array_length(p_parties) = 0 then
    raise exception 'At least one disputed Account is required.' using errcode = '23514';
  end if;
  if jsonb_typeof(p_actions) <> 'array' then
    raise exception 'Actions must be a JSON array.' using errcode = '22023';
  end if;

  insert into public.dispute_beta_cases (
    stem_id, stem_name, buyer_name, supplier_names, current_salesforce_status,
    workflow_status, approval_status, latest_note, settlement_financials,
    settlement_pnl, updated_at
  ) values (
    p_case->>'stem_id', nullif(p_case->>'stem_name', ''), nullif(p_case->>'buyer_name', ''),
    nullif(p_case->>'supplier_names', ''), nullif(p_case->>'current_salesforce_status', ''),
    coalesce(nullif(p_case->>'workflow_status', ''), 'Draft'),
    coalesce(nullif(p_case->>'approval_status', ''), 'Draft'),
    coalesce(p_case->>'latest_note', ''), coalesce(p_case->'settlement_financials', '{}'::jsonb),
    coalesce(nullif(p_case->>'settlement_pnl', '')::numeric, 0), now()
  )
  on conflict (stem_id) do update set
    stem_name = excluded.stem_name,
    buyer_name = excluded.buyer_name,
    supplier_names = excluded.supplier_names,
    current_salesforce_status = excluded.current_salesforce_status,
    workflow_status = excluded.workflow_status,
    approval_status = excluded.approval_status,
    latest_note = excluded.latest_note,
    settlement_financials = excluded.settlement_financials,
    settlement_pnl = excluded.settlement_pnl,
    updated_at = now()
  returning id into v_case_id;

  for v_party in select value from jsonb_array_elements(p_parties)
  loop
    insert into public.dispute_workflow_parties (
      case_id, stem_id, account_id, account_key, account_name, roles, source_types,
      source_record_ids, payment_terms, products, cancelled_source_only,
      created_by, created_by_email, updated_by, updated_by_email, updated_at
    ) values (
      v_case_id, p_case->>'stem_id', v_party->>'account_id', v_party->>'account_key',
      coalesce(v_party->>'account_name', ''),
      array(select jsonb_array_elements_text(coalesce(v_party->'roles', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(v_party->'source_types', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(v_party->'source_record_ids', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(v_party->'payment_terms', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(v_party->'products', '[]'::jsonb))),
      coalesce((v_party->>'cancelled_source_only')::boolean, false),
      v_actor_id, v_actor_email, v_actor_id, v_actor_email, now()
    )
    on conflict (case_id, account_key) do update set
      account_id = excluded.account_id,
      account_name = excluded.account_name,
      roles = excluded.roles,
      source_types = excluded.source_types,
      source_record_ids = excluded.source_record_ids,
      payment_terms = excluded.payment_terms,
      products = excluded.products,
      cancelled_source_only = excluded.cancelled_source_only,
      updated_by = excluded.updated_by,
      updated_by_email = excluded.updated_by_email,
      updated_at = now();
  end loop;

  delete from public.dispute_beta_actions a
  where a.case_id = v_case_id
    and not exists (
      select 1
      from jsonb_array_elements(p_actions) action_json
      where nullif(action_json->>'id', '')::uuid = a.id
    );

  for v_action in select value from jsonb_array_elements(p_actions)
  loop
    select id into v_party_id
    from public.dispute_workflow_parties
    where case_id = v_case_id and account_key = v_action->>'party_account_key';
    if v_party_id is null then
      raise exception 'Action references an unselected disputed Account.' using errcode = '23503';
    end if;

    v_action_id := nullif(v_action->>'id', '')::uuid;
    if v_action_id is not null and exists (
      select 1 from public.dispute_beta_actions where id = v_action_id and case_id = v_case_id
    ) then
      update public.dispute_beta_actions set
        party_id = v_party_id,
        party_side = v_action->>'party_side',
        action_type = v_action->>'action_type',
        action_label = coalesce(v_action->>'action_label', ''),
        amount = nullif(v_action->>'amount', '')::numeric,
        special_sell_price = nullif(v_action->>'special_sell_price', '')::numeric,
        special_buy_price = nullif(v_action->>'special_buy_price', '')::numeric,
        quantity = nullif(v_action->>'quantity', '')::numeric,
        quantity_unit = coalesce(nullif(v_action->>'quantity_unit', ''), 'MT'),
        close_reason = nullif(v_action->>'close_reason', ''),
        balance_payment_instruction = nullif(v_action->>'balance_payment_instruction', ''),
        description = coalesce(v_action->>'description', ''),
        requires_attachment = coalesce((v_action->>'requires_attachment')::boolean, false),
        execution_status = coalesce(nullif(v_action->>'execution_status', ''), 'Pending Accounting'),
        updated_by = v_actor_id,
        updated_by_email = v_actor_email,
        updated_at = now()
      where id = v_action_id and case_id = v_case_id;
    else
      insert into public.dispute_beta_actions (
        case_id, stem_id, party_id, party_side, action_type, action_label, amount,
        special_sell_price, special_buy_price, quantity, quantity_unit, close_reason,
        balance_payment_instruction, description, requires_attachment, execution_status,
        created_by, created_by_email, updated_by, updated_by_email
      ) values (
        v_case_id, p_case->>'stem_id', v_party_id, v_action->>'party_side',
        v_action->>'action_type', coalesce(v_action->>'action_label', ''),
        nullif(v_action->>'amount', '')::numeric,
        nullif(v_action->>'special_sell_price', '')::numeric,
        nullif(v_action->>'special_buy_price', '')::numeric,
        nullif(v_action->>'quantity', '')::numeric,
        coalesce(nullif(v_action->>'quantity_unit', ''), 'MT'),
        nullif(v_action->>'close_reason', ''),
        nullif(v_action->>'balance_payment_instruction', ''),
        coalesce(v_action->>'description', ''),
        coalesce((v_action->>'requires_attachment')::boolean, false),
        coalesce(nullif(v_action->>'execution_status', ''), 'Pending Accounting'),
        v_actor_id, v_actor_email, v_actor_id, v_actor_email
      );
    end if;
  end loop;

  delete from public.dispute_workflow_parties p
  where p.case_id = v_case_id
    and not exists (
      select 1
      from jsonb_array_elements(p_parties) party_json
      where party_json->>'account_key' = p.account_key
    );

  insert into public.dispute_beta_events (
    case_id, stem_id, event_type, note, actor_user_id, actor_email
  ) values (
    v_case_id, p_case->>'stem_id', 'draft_saved', nullif(p_event_note, ''), v_actor_id, v_actor_email
  );

  return v_case_id;
end;
$$;

revoke all on function public.save_dispute_workflow_draft(jsonb, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_dispute_workflow_draft(jsonb, jsonb, jsonb, jsonb, text) to service_role;
