-- Forward-only idempotent registration repair. A genuine authenticated job may
-- have a different environment/subject within the SAME admitted source/run.
-- Preserve stored principals, all journals, exact containment and every grant.
begin;
set local lock_timeout='5s';
do $forward$
declare
 c fcos_release_coordination.control%rowtype;
 target regprocedure:='fcos_release_coordination.qualification_source_upgrade_after_register(jsonb,jsonb)'::regprocedure;
 expected_tables text[]:=array['activations','approval_admissions','auth_maintenance_authorities','auth_maintenance_fences','auth_maintenance_occurrences','auth_maintenance_resolutions','auth_maintenance_revocations','auth_maintenance_saved_rotations','authorizations','control','cutover_bootstrap_actions','cutover_bootstrap_events','cutover_bootstrap_finishes','cutover_bootstraps','epochs','evidence','exact_7dc_publication_quarantine_revocations','exact_7dc_publication_quarantines','finishes','import_resolutions','imported_uncertainty','legacy_release_containment_revocations','legacy_release_containments','operation_events','operations','qualification_plan_completion_events','qualification_plan_completion_finishes','qualification_plan_completion_intents','qualification_plan_completions','qualification_schema_recoveries','qualification_schema_recovery_actions','qualification_schema_recovery_events','qualification_schema_recovery_finishes','qualification_source_upgrade_events','qualification_source_upgrade_intents','qualification_source_upgrade_milestones','qualification_source_upgrades','registration_runs','registrations','resume_admissions']::text[];
 actual_tables text[]; t text; n bigint; h text; pristine boolean;
 before_state jsonb:='{}';after_state jsonb:='{}';before_catalog jsonb;after_catalog jsonb;
 public_before text;definition text;
 needle text:=$needle$and x.actor=principal$needle$;
 replacement text:=$replacement$and qualification_source_upgrade_principal(u.proof,x.actor)
    -- Current principal came through the authenticated dispatch path. Preserve
    -- every stored actor/source/run/admission field except the two job contexts.
    and (x.actor-'environment'-'subject')=(principal-'environment'-'subject')
    and ((principal->'environment'='null'::jsonb
      and principal->>'subject'='repo:'||(u.proof->'policy'->>'repository')||':ref:'||(principal->>'ref'))
     or (principal->>'environment' in ('fcos-hosted-preview','fcos-hosted-verification')
      and principal->>'subject'='repo:'||(u.proof->'policy'->>'repository')||':environment:'||(principal->>'environment')))
    and ((x.actor->'environment'='null'::jsonb
      and x.actor->>'subject'='repo:'||(u.proof->'policy'->>'repository')||':ref:'||(x.actor->>'ref'))
     or (x.actor->>'environment' in ('fcos-hosted-preview','fcos-hosted-verification')
      and x.actor->>'subject'='repo:'||(u.proof->'policy'->>'repository')||':environment:'||(x.actor->>'environment')))$replacement$;
begin
 select * into c from fcos_release_coordination.control where singleton for update;
 select array_agg(p.relname::text order by p.relname::text collate "C") into actual_tables
  from pg_class p join pg_namespace s on s.oid=p.relnamespace
  where s.nspname='fcos_release_coordination' and p.relkind in ('r','p');
 if actual_tables is distinct from expected_tables then raise exception 'COORDINATION_REGISTRATION_CONTEXT_CATALOG_DRIFT';end if;
 foreach t in array actual_tables loop
  execute format('lock table fcos_release_coordination.%I in share row exclusive mode',t);
  execute format('select count(*),encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text collate "C"),''[]''::jsonb)::text,''UTF8'')),''hex'') from fcos_release_coordination.%I x',t) into n,h;
  before_state:=before_state||jsonb_build_object(t,jsonb_build_object('count',n,'sha256',h));
 end loop;
 pristine:=c.epoch is null and c.mode is not distinct from 'frozen';
 if c.singleton is distinct from true or c.operation_id is not null or c.bootstrap_id is not null or c.recovery_id is not null
  or c.plan_completion_id is not null or c.source_upgrade_id is not null
  or not (pristine or (c.epoch=1 and c.mode='qualification' and fcos_release_coordination.qualification_source_upgrade_quiescent()))
 then raise exception 'COORDINATION_REGISTRATION_CONTEXT_IN_USE';end if;
 if pristine then
  foreach t in array actual_tables loop
   if (before_state->t->>'count')::bigint is distinct from (case when t='control' then 1 else 0 end)
   then raise exception 'COORDINATION_REGISTRATION_CONTEXT_NONPRISTINE';end if;
  end loop;
 end if;
 -- Completed source-upgrade history remains a valid immutable prerequisite.
 if exists(select 1 from fcos_release_coordination.qualification_source_upgrades u
  where not fcos_release_coordination.qualification_source_upgrade_proof_valid(u.proof)
   or not exists(select 1 from fcos_release_coordination.qualification_source_upgrade_milestones m where m.operation_id=u.operation_id and m.milestone='dispatch_recorded'))
 then raise exception 'COORDINATION_REGISTRATION_CONTEXT_UNRESOLVED';end if;
 public_before:=fcos_release_coordination.qualification_schema_recovery_catalog_digest();
 if not pristine and public_before is distinct from '84ef2811eeefb87f8be4ef5219ab031f37fd3fd424a390e4c80b4afba7f13a4d'
 then raise exception 'COORDINATION_REGISTRATION_CONTEXT_PUBLIC_SCHEMA_CHANGED';end if;
 if not exists(select 1 from pg_proc p where p.oid=target
  and encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='12cf5aae1d9e1e34ad9851a63403e03689014896b05d6b57bc9466daa426ec27'
  and p.proowner='fcos_coordinator_owner'::regrole and not p.prosecdef
  and p.proconfig=array['search_path=pg_catalog, fcos_release_coordination']::text[]
  and p.proacl::text='{fcos_coordinator_owner=X/fcos_coordinator_owner,postgres=X/fcos_coordinator_owner}')
 then raise exception 'COORDINATION_REGISTRATION_CONTEXT_SOURCE_DRIFT';end if;
 select jsonb_agg((to_jsonb(p)-'prosrc')||jsonb_build_object('prosrcSha256',case when p.oid=target then 'TARGET' else encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') end) order by p.oid)
  into before_catalog from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='fcos_release_coordination';
 definition:=pg_get_functiondef(target);
 if array_length(string_to_array(definition,needle),1)<>2 then raise exception 'COORDINATION_REGISTRATION_CONTEXT_SOURCE_DRIFT';end if;
 execute replace(definition,needle,replacement);
 if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid=target) is distinct from '7c14d97bb20ae72b89d69e8092131540cb8db088a84aa369f2099c8086eb6629'
 then raise exception 'COORDINATION_REGISTRATION_CONTEXT_SOURCE_DRIFT';end if;
 select jsonb_agg((to_jsonb(p)-'prosrc')||jsonb_build_object('prosrcSha256',case when p.oid=target then 'TARGET' else encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') end) order by p.oid)
  into after_catalog from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='fcos_release_coordination';
 if before_catalog is distinct from after_catalog then raise exception 'COORDINATION_REGISTRATION_CONTEXT_IDENTITY_CHANGED';end if;
 foreach t in array actual_tables loop
  execute format('select count(*),encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text collate "C"),''[]''::jsonb)::text,''UTF8'')),''hex'') from fcos_release_coordination.%I x',t) into n,h;
  after_state:=after_state||jsonb_build_object(t,jsonb_build_object('count',n,'sha256',h));
 end loop;
 if before_state is distinct from after_state or public_before is distinct from fcos_release_coordination.qualification_schema_recovery_catalog_digest()
  or exists(select 1 from fcos_release_coordination.qualification_source_upgrades u where not fcos_release_coordination.qualification_source_upgrade_proof_valid(u.proof))
 then raise exception 'COORDINATION_REGISTRATION_CONTEXT_STATE_CHANGED';end if;
end $forward$;
commit;
