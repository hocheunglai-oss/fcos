begin;

-- The case-level confirmation_status column belongs to the retired single-stage
-- workflow. In the paired workflow, Salesforce supplier/buyer side statuses and
-- public.variable_charge_side_states are authoritative. Keeping this constraint
-- rejects a newly discovered, already-approved case before its side rows can be
-- synchronized.
alter table public.variable_charge_cases
  drop constraint if exists ship_agent_charge_cases_check;

comment on column public.variable_charge_cases.confirmation_status is
  'Legacy aggregate status retained for compatibility. Paired Variable Charges readiness is governed by Salesforce side statuses and variable_charge_side_states.';

commit;
