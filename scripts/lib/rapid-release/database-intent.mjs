import { randomUUID } from 'node:crypto';
import { mkdirSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { digest, git, isSha, requireCondition as check, targets } from './contract.mjs';
import { MANAGED_DATABASE_ROLE_SQL } from './database-connection.mjs';

const ENVIRONMENT = 'fcos-database-auth-journal-v1';
const KIND = 'fcos_native_database_auth';
// A credential operation is separate from a release and grants no release authority.
// Its public journal contains catalog facts and acknowledgements, never secrets.
export async function createDatabaseCredentialIntentStore({ credential, directory, source, purpose, github, fetchImpl = fetch, now = Date.now }) {
  check(credential?.kind === 'supabase_management' && typeof credential.token === 'string'
    && typeof directory === 'string' && isSha(source?.sha) && /^[a-z_]{8,64}$/.test(purpose || ''), 'DATABASE_AUTH_CONTEXT_REQUIRED');
  check(git(directory, ['rev-parse','HEAD']) === source.sha
    && !git(directory, ['status','--porcelain','--untracked-files=no']), 'DATABASE_AUTH_FROZEN_SOURCE_REQUIRED');
  const defaultBot = !github && !process.env.FCOS_RAPID_HANDOVER_GITHUB_TOKEN && process.env.GITHUB_ACTIONS === 'true';
  if (!github) {
    check(process.env.GITHUB_ACTIONS === 'true', 'DATABASE_AUTH_NATIVE_GITHUB_REQUIRED');
    const { githubClient } = await import('./providers.mjs');
    github = githubClient({ token: process.env.FCOS_RAPID_HANDOVER_GITHUB_TOKEN || process.env.GITHUB_TOKEN });
  }
  const base = `/repos/${targets().repository}`;
  const [repository, actor] = await Promise.all([github.read(base), github.read(defaultBot ? '/users/github-actions%5Bbot%5D' : '/user')]);
  check(repository.full_name === targets().repository && !repository.archived
    && [targets().account,'github-actions[bot]'].includes(actor.login) && Number.isSafeInteger(actor.id), 'DATABASE_AUTH_GITHUB_IDENTITY_MISMATCH');
  const output = join(directory,'outputs','rapid-database-credentials');
  mkdirSync(output,{recursive:true,mode:0o700});
  const persist = record => {
    const path = join(output, `${record.intentId}-${record.event}.json`);
    const fd = openSync(path,'wx',0o600);
    try { writeSync(fd, `${JSON.stringify(record)}\n`);fsyncSync(fd); } finally {closeSync(fd);}
  };
  const rows = () => github.pages(`${base}/deployments?environment=${ENVIRONMENT}&per_page=100`);
  const publish = async record => {
    persist(record);
    const result = await github.write(`${base}/deployments`,{ref:source.sha,environment:ENVIRONMENT,
      auto_merge:false,required_contexts:[],production_environment:false,transient_environment:false,
      description:'FCOS temporary database authentication journal',payload:{kind:KIND,...record}});
    check(result.creator?.id === actor.id && result.sha === source.sha
      && result.payload?.intentId === record.intentId && result.payload.event === record.event
      && digest(result.payload) === digest({kind:KIND,...record}), 'DATABASE_AUTH_JOURNAL_ACK_REQUIRED');
    return result;
  };
  let current;
  return {
    async begin(request) {
      check(!current && request.projectRef === targets().supabaseProject && request.method === 'POST'
        && request.role === 'cli_login_postgres' && request.body?.read_only === false, 'DATABASE_AUTH_REQUEST_REFUSED');
      const all = (await rows()).filter(row => row.payload?.kind === KIND);
      check(all.every(row => [targets().account,'github-actions[bot]'].includes(row.creator?.login)), 'DATABASE_AUTH_JOURNAL_ACTOR_MISMATCH');
      const closed = new Set(all.filter(row => row.payload.event === 'received').map(row => row.payload.intentId));
      check(!all.some(row => row.payload.event === 'intent' && !closed.has(row.payload.intentId)), 'DATABASE_AUTH_ORIGINAL_OPERATION_UNCERTAIN');
      const url = `https://api.supabase.com/v1/projects/${targets().supabaseProject}/database/query`;
      let response;
      try {response=await fetchImpl(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{
        Authorization:`Bearer ${credential.token}`,'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({query:MANAGED_DATABASE_ROLE_SQL,read_only:true})});} catch {throw Error('DATABASE_AUTH_ROLE_PREFLIGHT_UNAVAILABLE');}
      check(response.status===201 && response.url===url && !response.redirected,'DATABASE_AUTH_ROLE_PREFLIGHT_UNAVAILABLE');
      let roleRows;try {roleRows=await response.json();} catch {throw Error('DATABASE_AUTH_ROLE_PREFLIGHT_UNAVAILABLE');}
      check(Array.isArray(roleRows) && roleRows.length===1 && roleRows[0].current_user==='supabase_read_only_user' && roleRows[0].session_user==='supabase_read_only_user'
        && roleRows[0].database==='postgres','DATABASE_AUTH_ROLE_PREFLIGHT_INVALID');
      const preflight={projectRef:targets().supabaseProject,observedAtMs:now(),role:roleRows[0]};
      const intentId=`fcos-db-auth-${randomUUID()}`;
      current={intentId,requestDigest:request.requestDigest,sourceSha:source.sha,purpose};
      await publish({...current,event:'intent',request,preflight,observedAt:new Date(now()).toISOString()});
      return {state:'fresh',...current,preflight};
    },
    async complete(receipt) {
      check(current && receipt.intentId===current.intentId && receipt.requestDigest===current.requestDigest
        && receipt.outcome==='received' && Object.keys(receipt).every(key=>['intentId','requestDigest','outcome','issuer','projectRef','role','ttlSeconds','issuedAtMs','expiresAtMs'].includes(key)), 'DATABASE_AUTH_RECEIPT_REFUSED');
      await publish({...current,event:'received',receipt,observedAt:new Date(now()).toISOString()});
    },
    async uncertain(receipt) {
      check(current && receipt.intentId===current.intentId && receipt.requestDigest===current.requestDigest,'DATABASE_AUTH_RECEIPT_REFUSED');
      persist({...current,event:'unknown',code:'SUPABASE_LOGIN_ROLE_OUTCOME_UNKNOWN',observedAt:new Date(now()).toISOString()});
      // Original durable intent stays open. No status change or retry can close it.
    },
  };
}
