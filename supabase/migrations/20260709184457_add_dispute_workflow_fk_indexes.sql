create index if not exists dispute_beta_actions_accounting_by_idx
on public.dispute_beta_actions(accounting_by)
where accounting_by is not null;

create index if not exists dispute_workflow_documents_uploaded_by_idx
on public.dispute_workflow_documents(uploaded_by)
where uploaded_by is not null;
