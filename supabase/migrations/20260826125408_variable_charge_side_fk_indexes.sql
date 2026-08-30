-- Cover every foreign key introduced by the paired Variable Charges ledger.
-- These indexes support assignment administration, immutable audit attribution,
-- and operation reconciliation without exposing the service-only tables.

create index variable_charge_side_states_default_assignee_idx
  on public.variable_charge_side_states(default_assignee_user_id);

create index variable_charge_side_states_assigned_by_idx
  on public.variable_charge_side_states(assigned_by_user_id);

create index variable_charge_side_confirmations_confirmed_by_idx
  on public.variable_charge_side_confirmations(confirmed_by);

create index variable_charge_side_confirmations_operation_lookup_idx
  on public.variable_charge_side_confirmations(operation_id)
  where operation_id is not null;
