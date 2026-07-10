create index if not exists dispute_beta_actions_party_case_fk_idx
on public.dispute_beta_actions(party_id, case_id);

create index if not exists dispute_workflow_documents_party_case_fk_idx
on public.dispute_workflow_documents(party_id, case_id);
