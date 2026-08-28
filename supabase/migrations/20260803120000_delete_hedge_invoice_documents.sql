begin;

create or replace function public.delete_hedge_invoice_with_documents(
  p_invoice_id uuid,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_invoice public.hedge_invoices%rowtype;
  v_storage_paths text[] := array[]::text[];
  v_removed_document_count integer := 0;
begin
  select *
    into v_invoice
  from public.hedge_invoices
  where id = p_invoice_id
  for update;

  if v_invoice.id is null then
    raise exception 'Hedge Desk invoice was not found';
  end if;
  if p_expected_revision is null or v_invoice.revision <> p_expected_revision then
    raise exception 'This Hedge Desk invoice changed after it was opened';
  end if;

  select coalesce(array_agg(storage_path order by created_at), array[]::text[])
    into v_storage_paths
  from public.hedge_documents
  where invoice_id = p_invoice_id;

  delete from public.hedge_documents
  where invoice_id = p_invoice_id;
  get diagnostics v_removed_document_count = row_count;

  delete from public.hedge_invoices
  where id = p_invoice_id
    and revision = p_expected_revision;
  if not found then
    raise exception 'This Hedge Desk invoice changed after it was opened';
  end if;

  return jsonb_build_object(
    'deleted', true,
    'storagePaths', to_jsonb(v_storage_paths),
    'removedDocumentCount', v_removed_document_count
  );
end;
$$;

revoke all on function public.delete_hedge_invoice_with_documents(uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.delete_hedge_invoice_with_documents(uuid, bigint)
  to service_role;

commit;
