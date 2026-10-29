-- One exact expired public GitHub variable submission remains UNKNOWN.
-- This private, append-only admission never resolves/replays that submission.
begin;

-- Actual observed prosrc digests: containment owner readback 2026-10-20
-- 07:44Z (3c1b...), bootstrap owner readback 09:10Z (b18d...).
do $$ begin
 if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc
     where oid='fcos_release_coordination.legacy_release_unknowns_contained(fcos_release_coordination.registrations,jsonb,boolean)'::regprocedure)
      is distinct from '3c1b8ef1eebb6a54f558a67ab0ca61526a4fb189838220267d569f2e27be8652'
 or (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc
     where oid='fcos_release_coordination.cutover_bootstrap_proof_valid(jsonb)'::regprocedure)
      is distinct from 'b18d9b3ac637374d476533700bcc9486159ebd3e603233de2eb7c57a77609424'
 then raise exception 'COORDINATION_EXACT_7DC_SOURCE_DRIFT'; end if;
end $$;

create table fcos_release_coordination.exact_7dc_publication_quarantines (
 import_id text primary key check(import_id='replacement-template-7dc21331fe45'),
 epoch bigint not null references fcos_release_coordination.epochs(epoch),
 proof jsonb not null,
 proof_sha256 text not null check(proof_sha256 ~ '^[0-9a-f]{64}$'),
 recorded_at timestamptz not null default clock_timestamp()
);
create table fcos_release_coordination.exact_7dc_publication_quarantine_revocations (
 import_id text primary key references fcos_release_coordination.exact_7dc_publication_quarantines(import_id),
 proof_sha256 text not null check(proof_sha256 ~ '^[0-9a-f]{64}$'),
 root_review_sha256 text not null check(root_review_sha256 ~ '^[0-9a-f]{64}$'),
 recorded_at timestamptz not null default clock_timestamp()
);
alter table fcos_release_coordination.exact_7dc_publication_quarantines enable row level security;
alter table fcos_release_coordination.exact_7dc_publication_quarantine_revocations enable row level security;
revoke all on fcos_release_coordination.exact_7dc_publication_quarantines,
 fcos_release_coordination.exact_7dc_publication_quarantine_revocations from public,anon,authenticated,service_role,fcos_coordinator_runtime;

create function fcos_release_coordination.exact_7dc_publication_proof_valid(p jsonb) returns boolean
language plpgsql stable set search_path=pg_catalog,fcos_release_coordination as $$
declare u imported_uncertainty%rowtype; installed jsonb; original jsonb; request jsonb; template jsonb;
 review jsonb; scope_hash text; expected_lease jsonb:=jsonb_build_object(
  'epoch','production-reconciliation-20261005','objective','production',
  'ownerThreadId','01a0f08b-7fcb-7870-9edc-343e16052b62',
  'operationId','replacement-template-7dc21331fe45',
  'bindingSha256','5ccc27b86d0d2e203191df41491e9d2e5412543936a2b270d205c7e111f9c4e1',
  'leaseId','84eca9c7-80fe-4976-bcf3-13a62f2e31a2');
begin
 if not auth_maintenance_object(p,array['schemaVersion','kind','epoch','importId','ownerThreadId','originalLease',
  'importedEvidenceSha256','originalIntentJson','originalRequestJson','originalGuardedResultSha256',
  'localCancellationReceiptSha256','localCancellationResolutionSha256','sourceAcceptanceSha256','templateSha256','valueSha256',
  'templateNotAfter','expiryGuards','possibleLateMetadataEffect','originalOutcome','replayAllowed','financialAuthorityGranted',
  'hostCreationAllowed','warmDispatchAllowed','allOriginalMarkersPreserved','noOriginalHostOrWarmDispatchProofSha256',
  'inventorySha256','legacyFenceSha256','rootReview','independentReview'])
  or p->'schemaVersion' is distinct from '1'::jsonb or p->>'kind' is distinct from 'exact_7dc_public_metadata_quarantine_v1'
  or p->>'importId' is distinct from 'replacement-template-7dc21331fe45'
  or p->>'ownerThreadId' is distinct from expected_lease->>'ownerThreadId' or p->'originalLease' is distinct from expected_lease
  or jsonb_typeof(p->'epoch') is distinct from 'number' or p->>'epoch' !~ '^[1-9][0-9]{0,17}$'
  or p->>'originalOutcome' is distinct from 'unknown' or p->'possibleLateMetadataEffect' is distinct from 'true'::jsonb
  or p->'replayAllowed' is distinct from 'false'::jsonb or p->'financialAuthorityGranted' is distinct from 'false'::jsonb
  or p->'hostCreationAllowed' is distinct from 'false'::jsonb or p->'warmDispatchAllowed' is distinct from 'false'::jsonb
  or p->'allOriginalMarkersPreserved' is distinct from 'true'::jsonb
  or p->>'originalGuardedResultSha256' is distinct from '45bce1f5843c638ad6e9c5fa052efc7a0ecc207533a35141382f23a12c9adb88'
  or p->>'localCancellationReceiptSha256' is distinct from '518a39b00abc6ee876d9e8aa9324bc3436431588acbd055759ebcbcb86bb1330'
  or p->>'localCancellationResolutionSha256' is distinct from '8184bca0e5512cf4c7720eee619f2931de8e141b5327bb9a794e98dfed352695'
  or p->>'sourceAcceptanceSha256' is distinct from expected_lease->>'bindingSha256'
  or p->>'templateSha256' is distinct from 'ed2b7b44d4b1c8a6b5e7df33b6ead2f2d1bd830d9589e83df47cb844cf354556'
  or p->>'valueSha256' is distinct from '8a65468047b4c2c6266ab2539472405eab210381c46470e207e5eca4e80bb69f'
  or p->'templateNotAfter' is distinct from '1792522490726'::jsonb
  or extract(epoch from statement_timestamp())*1000 <= 1792522490726
  or p->'expiryGuards' is distinct from jsonb_build_object(
    'nativeRelaySha256','a8f15ea0e0610a5fee84dfa5e23aec3ab09ac3f8224d5d0e2db2f0ad13da25be',
    'carrierSha256','f1083979827e85fe8b933bea1cc0f80aa245ba5a9889e5165db17af2a61743d3',
    'stepProtocolSha256','e3ebeb7a1ae02c0ad5bdf2b854f6258d2f2a93a0e5c26b0cbcfc3b99e4e71922')
 then return false; end if;
 if exists(select 1 from jsonb_each(p) e where e.key=any(array['importedEvidenceSha256','inventorySha256','legacyFenceSha256',
   'noOriginalHostOrWarmDispatchProofSha256']) and (jsonb_typeof(e.value)<>'string' or (e.value#>>'{}') !~ '^[0-9a-f]{64}$'))
  or jsonb_typeof(p->'originalIntentJson') is distinct from 'string' or octet_length(p->>'originalIntentJson')>4096
  or jsonb_typeof(p->'originalRequestJson') is distinct from 'string' or octet_length(p->>'originalRequestJson')>100000
  or encode(sha256(convert_to(p->>'originalIntentJson','UTF8')),'hex') is distinct from '11bf7691f94955c19ca0c6005d0b560d0c1ebbb74c8ba0f3a8a27ffe43a974c2'
  or encode(sha256(convert_to(p->>'originalRequestJson','UTF8')),'hex') is distinct from '0ffec25f866167ae1dd11a6077d6ebf37fa45d2a06a5822b80ac87c942c668c7'
 then return false; end if;
 begin
  original:=(p->>'originalIntentJson')::jsonb; request:=(p->>'originalRequestJson')::jsonb;
  template:=convert_from(decode(request->>'value','base64'),'UTF8')::jsonb;
 exception when others then return false; end;
 if original->>'state' is distinct from 'prepared' or original->'lease' @> expected_lease is distinct from true
  or not auth_maintenance_object(request,array['name','value'])
  or request->>'name' is distinct from 'FCOS_XERO_ORIGINAL_CARRIER_TEMPLATE_BASE64'
  or encode(sha256(convert_to(request->>'value','UTF8')),'hex') is distinct from p->>'valueSha256'
  or encode(sha256(decode(request->>'value','base64')),'hex') is distinct from p->>'templateSha256'
  or template->'notAfter' is distinct from p->'templateNotAfter'
 then return false; end if;
 select * into u from imported_uncertainty where import_id=p->>'importId';
 select activation_evidence into installed from epochs where epoch=(p->>'epoch')::bigint;
 if u.import_id is null or u.epoch::text is distinct from p->>'epoch'
  or auth_maintenance_hash(u.evidence) is distinct from p->>'importedEvidenceSha256'
  or u.evidence->>'operationId' is distinct from p->>'importId'
  or u.evidence->>'ownerThreadId' is distinct from p->>'ownerThreadId'
  or u.evidence->>'evidenceHash' is distinct from '11bf7691f94955c19ca0c6005d0b560d0c1ebbb74c8ba0f3a8a27ffe43a974c2'
  or exists(select 1 from import_resolutions z where z.import_id=u.import_id)
  or installed->'legacyFence'->>'kind' is distinct from 'permanent_legacy_sentinel'
  or installed->'legacyFence'->>'proofHash' is distinct from p->>'legacyFenceSha256'
  or installed->>'inventoryHash' is distinct from p->>'inventorySha256'
 then return false; end if;
 scope_hash:=auth_maintenance_hash(p-'rootReview'-'independentReview');
 for review in select p->'rootReview' union all select p->'independentReview' loop
  if not auth_maintenance_object(review,array['kind','accepted','role','reviewerId','scopeSha256','reviewedAt','exactOriginalEvidenceReviewed','expiredMetadataConfinementReviewed'])
   or review->>'kind' is distinct from 'fcos_exact_7dc_public_metadata_quarantine_review_v1'
   or review->'accepted' is distinct from 'true'::jsonb or review->>'scopeSha256' is distinct from scope_hash
   or review->'exactOriginalEvidenceReviewed' is distinct from 'true'::jsonb
   or review->'expiredMetadataConfinementReviewed' is distinct from 'true'::jsonb
   or jsonb_typeof(review->'reviewedAt') is distinct from 'string'
  then return false; end if;
  begin
   if not isfinite((review->>'reviewedAt')::timestamptz) or (review->>'reviewedAt')::timestamptz > statement_timestamp()+interval '30 seconds' then return false; end if;
  exception when others then return false; end;
 end loop;
 return coalesce(p->'rootReview'->>'role'='root' and p->'rootReview'->>'reviewerId'='/root'
  and p->'independentReview'->>'role'='independent'
  and p->'independentReview'->>'reviewerId' ~ '^/root/[a-z0-9_]+(/[a-z0-9_]+)*$',false);
end $$;

create function fcos_release_coordination.exact_7dc_publication_quarantined(id text, expected_epoch bigint) returns boolean
language sql stable set search_path=pg_catalog,fcos_release_coordination as $$
 select id='replacement-template-7dc21331fe45' and exists(
  select 1 from exact_7dc_publication_quarantines q join control c on c.singleton
  where q.import_id=id and q.epoch=expected_epoch and c.epoch=q.epoch
   and q.proof_sha256=auth_maintenance_hash(q.proof) and exact_7dc_publication_proof_valid(q.proof)
   and not exists(select 1 from exact_7dc_publication_quarantine_revocations z where z.import_id=q.import_id));
$$;

create function fcos_release_coordination.admit_exact_7dc_publication_quarantine(p jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
declare c control%rowtype; prior exact_7dc_publication_quarantines%rowtype;
begin
 select * into c from control where singleton for update;
 if exact_7dc_publication_proof_valid(p) is distinct from true then raise exception 'COORDINATION_EXACT_7DC_ADMISSION_INVALID'; end if;
 select * into prior from exact_7dc_publication_quarantines where import_id=p->>'importId';
 if prior.import_id is not null then
  if prior.proof is distinct from p then raise exception 'COORDINATION_EXACT_7DC_CONFLICT'; end if;
  return jsonb_build_object('disposition','readback','originalOutcome','unknown','replayAllowed',false);
 end if;
 if c.mode is distinct from 'qualification' or c.epoch::text is distinct from p->>'epoch'
  or c.operation_id is not null or c.bootstrap_id is not null
  or exists(select 1 from registrations where epoch=c.epoch)
 then raise exception 'COORDINATION_EXACT_7DC_ADMISSION_INVALID'; end if;
 insert into exact_7dc_publication_quarantines(import_id,epoch,proof,proof_sha256)
  values(p->>'importId',c.epoch,p,auth_maintenance_hash(p));
 return jsonb_build_object('disposition','admitted','originalOutcome','unknown','replayAllowed',false,'financialAuthorityGranted',false);
end $$;

create function fcos_release_coordination.revoke_exact_7dc_publication_quarantine(id text, proof_hash text, root_review_hash text) returns void
language plpgsql security definer set search_path=pg_catalog,fcos_release_coordination as $$
begin
 perform 1 from control where singleton for update;
 if id is distinct from 'replacement-template-7dc21331fe45' or root_review_hash !~ '^[0-9a-f]{64}$' or root_review_hash is null
  or not exists(select 1 from exact_7dc_publication_quarantines q where q.import_id=id and q.proof_sha256=proof_hash)
 then raise exception 'COORDINATION_EXACT_7DC_REVOCATION_INVALID'; end if;
 insert into exact_7dc_publication_quarantine_revocations values(id,proof_hash,root_review_hash,clock_timestamp())
  on conflict(import_id) do nothing;
end $$;

-- Preserve OIDs, signatures, owners, security modes, search paths and ACLs.
-- Only these two exact predicates change; financial/auth-maintenance do not.
do $$ declare definition text; needle text; replacement text; begin
 definition:=pg_get_functiondef('fcos_release_coordination.cutover_bootstrap_proof_valid(jsonb)'::regprocedure);
 needle:='(select count(*) from imported_uncertainty u left join import_resolutions z using(import_id) where z.import_id is null)<>2';
 replacement:='(select count(*) from imported_uncertainty quarantine_unknown left join import_resolutions z using(import_id) where z.import_id is null and not fcos_release_coordination.exact_7dc_publication_quarantined(quarantine_unknown.import_id,quarantine_unknown.epoch))<>2';
 if position(needle in definition)=0 then raise exception 'COORDINATION_EXACT_7DC_SOURCE_DRIFT'; end if;
 execute replace(definition,needle,replacement);
 definition:=pg_get_functiondef('fcos_release_coordination.legacy_release_unknowns_contained(fcos_release_coordination.registrations,jsonb,boolean)'::regprocedure);
 needle:='for u in select x.* from imported_uncertainty x left join import_resolutions z using(import_id) where z.import_id is null loop';
 replacement:=needle||E'\n  if fcos_release_coordination.exact_7dc_publication_quarantined(u.import_id,r.epoch) then continue; end if;';
 if position(needle in definition)=0 then raise exception 'COORDINATION_EXACT_7DC_SOURCE_DRIFT'; end if;
 execute replace(definition,needle,replacement);
end $$;

do $$ declare t text; f regprocedure; begin
 foreach t in array array['exact_7dc_publication_quarantines','exact_7dc_publication_quarantine_revocations'] loop
  execute format('alter table fcos_release_coordination.%I owner to fcos_coordinator_owner',t);
  execute format('create trigger exact_7dc_append_only before update or delete or truncate on fcos_release_coordination.%I for each statement execute function fcos_release_coordination.reject_mutation()',t);
 end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='fcos_release_coordination' and p.proname in ('exact_7dc_publication_proof_valid','exact_7dc_publication_quarantined','admit_exact_7dc_publication_quarantine','revoke_exact_7dc_publication_quarantine') loop
  execute format('alter function %s owner to fcos_coordinator_owner',f);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,fcos_coordinator_runtime',f);
 end loop;
end $$;
grant execute on function fcos_release_coordination.admit_exact_7dc_publication_quarantine(jsonb),
 fcos_release_coordination.revoke_exact_7dc_publication_quarantine(text,text,text) to postgres;
commit;
