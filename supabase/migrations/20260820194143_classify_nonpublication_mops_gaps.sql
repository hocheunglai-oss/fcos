begin;

-- Preserve the canonical publisher while classifying reviewed-session holiday
-- reprints as an incomplete publication gap, not a price conflict. A genuine
-- evidence conflict or ledger mismatch remains conflict and still fails closed.
alter function public.publish_market_mops_from_import(uuid)
  rename to publish_market_mops_from_import_canonical_core;

create or replace function public.publish_market_mops_from_import(p_import_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
begin
  v_result := public.publish_market_mops_from_import_canonical_core(p_import_id);

  if v_result->>'status' = 'conflict'
     and not exists (
       select 1
       from public.market_mops_publications publication
       where publication.import_id = p_import_id
         and publication.outcome = 'conflict'
     )
     and exists (
       select 1
       from public.market_observation_evidence evidence
       join public.market_intelligence_series series on series.id = evidence.series_id
       where evidence.import_id = p_import_id
         and series.source_symbol in ('AMFSA00', 'PPXDK00', 'POABC00')
         and evidence.disposition = 'quarantined'
         and evidence.conflict_code = 'NON_PUBLICATION_DAY_REPRINT'
     )
     and not exists (
       select 1
       from public.market_observation_evidence evidence
       join public.market_intelligence_series series on series.id = evidence.series_id
       where evidence.import_id = p_import_id
         and series.source_symbol in ('AMFSA00', 'PPXDK00', 'POABC00')
         and evidence.disposition = 'quarantined'
         and evidence.conflict_code is distinct from 'NON_PUBLICATION_DAY_REPRINT'
     ) then
    update public.market_report_imports
    set mops_publication_status = 'incomplete',
        mops_publication_id = null
    where id = p_import_id;
    return v_result || jsonb_build_object(
      'status', 'incomplete',
      'conflictCode', null,
      'nonPublicationGap', true
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.publish_market_mops_from_import_canonical_core(uuid)
  from public, anon, authenticated;
revoke all on function public.publish_market_mops_from_import(uuid)
  from public, anon, authenticated;
grant execute on function public.publish_market_mops_from_import_canonical_core(uuid)
  to service_role;
grant execute on function public.publish_market_mops_from_import(uuid)
  to service_role;

commit;
