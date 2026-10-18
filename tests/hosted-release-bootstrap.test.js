import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const template = readFileSync(new URL('../.github/qualification/hosted-release-bootstrap.yml', import.meta.url), 'utf8');
const definition = yaml.load(template);
const environmentSecrets = [
  'FCOS_E2E_VERCEL_BYPASS', 'FCOS_HOSTED_FCUNO_READ_TOKEN', 'FCOS_HOSTED_GITHUB_READ_TOKEN',
  'FCOS_HOSTED_NORMAL_EMAIL', 'FCOS_HOSTED_NORMAL_PASSWORD', 'FCOS_HOSTED_PRESERVATION_DATABASE_URL',
  'FCOS_HOSTED_RESTRICTED_EMAIL', 'FCOS_HOSTED_RESTRICTED_FALLBACK_EMAIL', 'FCOS_HOSTED_RESTRICTED_FALLBACK_PASSWORD', 'FCOS_HOSTED_RESTRICTED_PASSWORD', 'FCOS_HOSTED_RUNTIME_EMAIL',
  'FCOS_HOSTED_RUNTIME_PASSWORD', 'FCOS_HOSTED_SALESFORCE_CLIENT_SECRET', 'FCOS_HOSTED_SCHEMA_DATABASE_URL',
  'FCOS_HOSTED_VERCEL_READ_TOKEN', 'FCOS_HOSTED_VERCEL_TOKEN', 'FCOS_PRODUCTION_VERIFICATION_BYPASS',
];
const qualificationSecrets = environmentSecrets.filter(name => name !== 'FCOS_PRODUCTION_VERIFICATION_BYPASS');
const fallbackSources={FCOS_HOSTED_RESTRICTED_FALLBACK_EMAIL:'FCOS_E2E_EMAIL',FCOS_HOSTED_RESTRICTED_FALLBACK_PASSWORD:'FCOS_E2E_PASSWORD'};
const optionalSecrets=new Set(['FCOS_HOSTED_SALESFORCE_CLIENT_SECRET','FCOS_HOSTED_FCUNO_READ_TOKEN','FCOS_HOSTED_RESTRICTED_EMAIL','FCOS_HOSTED_RESTRICTED_PASSWORD',...Object.keys(fallbackSources),'FCOS_PRODUCTION_VERIFICATION_BYPASS']);
const forwarding = names => Object.fromEntries(names.map(name => [name, `\${{ secrets.${fallbackSources[name] || name} }}`]));

test('qualification bootstrap stays inactive and calls the same immutable controller', () => {
  assert.deepEqual(Object.keys(definition.on), ['workflow_dispatch']);
  assert.deepEqual(definition.permissions, {});
  assert.deepEqual(Object.keys(definition.jobs), ['toolchain', 'setup_discovery', 'preservation_preflight', 'manifest', 'release', 'xero_owner_readback', 'xero_original_warm']);
  assert.equal(definition.jobs.manifest.if, "${{ inputs.xero_recovery_mode == 'disabled' && inputs.bootstrap_phase == 'qualification' && vars.FCOS_HOSTED_QUALIFICATION_ADMITTED == 'true' }}");
  assert.equal(definition.jobs.manifest.environment, 'fcos-hosted-verification');
  assert.deepEqual(definition.jobs.manifest.permissions, { contents: 'read', actions: 'read' });
  assert.equal(template.split('__FCOS_CONTROLLER_SHA__').length - 1, 13);
  const sha = 'a'.repeat(40), rendered = yaml.load(template.replaceAll('__FCOS_CONTROLLER_SHA__', sha));
  assert.equal(rendered.jobs.manifest.env.FCOS_CONTROLLER_SHA, sha);
  assert.equal(rendered.jobs.manifest.steps[0].with.ref, sha);
  assert.equal(rendered.jobs.release.uses, `hocheunglai-oss/fcos/.github/workflows/hosted-release-controller.yml@${sha}`);
  assert.deepEqual(rendered.jobs.release.secrets, forwarding(qualificationSecrets));
  assert.equal(rendered.jobs.toolchain.if, "${{ inputs.xero_recovery_mode == 'disabled' && inputs.bootstrap_phase == 'toolchain' }}");
  assert.equal(rendered.jobs.toolchain.uses, `hocheunglai-oss/fcos/.github/workflows/hosted-release-toolchain.yml@${sha}`);
  assert.equal(rendered.jobs.toolchain.with.source_sha, sha);
  assert.equal(rendered.jobs.toolchain.secrets, undefined);
  assert.deepEqual(rendered.jobs.toolchain.permissions, { contents: 'read', actions: 'read', packages: 'write' });
  assert.equal(rendered.jobs.manifest.env.FCOS_QUALIFICATION_BOOTSTRAP, 'true');
  const controller = yaml.load(readFileSync(new URL('../.github/workflows/hosted-release-controller.yml', import.meta.url), 'utf8'));
  assert.deepEqual(controller.on.workflow_call.secrets, Object.fromEntries(environmentSecrets.map(name =>
    [name, { required: !optionalSecrets.has(name) }])));
  const mainCaller = yaml.load(readFileSync(new URL('../.github/workflows/hosted-release.yml', import.meta.url), 'utf8'));
  assert.deepEqual(mainCaller.jobs.release.secrets, forwarding(environmentSecrets));
  assert.doesNotMatch(JSON.stringify(controller.jobs.checks), /secrets\./);
  assert.equal(controller.env.FCOS_HOSTED_QUALIFICATION_ADMITTED, '${{ vars.FCOS_HOSTED_QUALIFICATION_ADMITTED }}');
});

test('every reusable environment secret is explicitly admitted without exposing provider values to candidate jobs', () => {
  const controller = yaml.load(readFileSync(new URL('../.github/workflows/hosted-release-controller.yml', import.meta.url), 'utf8'));
  const referenced = new Set();
  for (const [id, job] of Object.entries(controller.jobs)) {
    for (const [, name] of JSON.stringify(job).matchAll(/secrets\.([A-Z0-9_]+)/g)) {
      referenced.add(name);
      assert.ok(controller.on.workflow_call.secrets[name], `${id} references an undeclared secret`);
      if (name !== 'FCOS_HOSTED_GITHUB_READ_TOKEN') assert.ok(job.environment, `${id} exposes a provider secret without a protected environment`);
      if (name === 'FCOS_PRODUCTION_VERIFICATION_BYPASS') assert.equal(job.environment, 'fcos-hosted-production-resume');
    }
  }
  assert.deepEqual([...referenced].sort(), environmentSecrets);
  assert.equal(controller.jobs.checks.environment, undefined);
  assert.doesNotMatch(JSON.stringify(controller.jobs.checks), /secrets\./);
  assert.equal(definition.jobs.release.secrets.FCOS_PRODUCTION_VERIFICATION_BYPASS, undefined);
  assert.notEqual(definition.jobs.release.secrets, 'inherit');
});

test('bootstrap checks scope and live read-only admission before candidate checkout or provider access', () => {
  const steps = definition.jobs.manifest.steps;
  const admission = steps.findIndex(step => step.name === 'Admit qualification dispatch before candidate checkout');
  const dependencies = steps.findIndex(step => step.name === 'Install admitted controller dependencies');
  const checkout = steps.findIndex(step => step.with?.path === 'candidate');
  const prepare = steps.findIndex(step => step.name === 'Prepare actual qualification manifest');
  assert.ok(dependencies > 0 && dependencies < admission && admission < checkout && checkout < prepare);
  assert.equal(steps[dependencies].run, 'npm ci --ignore-scripts --no-audit --no-fund');
  assert.equal(steps[dependencies]['working-directory'], 'controller');
  assert.equal(steps[dependencies].env, undefined);
  assert.deepEqual(Object.keys(steps[admission].env).sort(), ['FCOS_HOSTED_GITHUB_READ_TOKEN', 'GITHUB_TOKEN']);
  assert.ok(steps[admission].run.includes('node controller/scripts/hosted-release-manifest.mjs --validate-dispatch-only'));
  const qualification = {...definition,jobs:Object.fromEntries(Object.entries(definition.jobs).filter(([id])=>!['xero_owner_readback','xero_original_warm'].includes(id)))};
  const secrets = [...JSON.stringify(qualification).matchAll(/secrets\.([A-Z0-9_]+)/g)].map(match => match[1]);
  assert.deepEqual([...new Set(secrets)].sort(), environmentSecrets.map(name=>fallbackSources[name]||name).sort());
  assert.ok(!secrets.includes('FCOS_HOSTED_VERCEL_PRODUCTION_TOKEN'));
});

test('actual bootstrap shell refuses release scopes before invoking the controller admission', () => {
  const script = definition.jobs.manifest.steps.find(step => step.name === 'Admit qualification dispatch before candidate checkout').run;
  const directory = mkdtempSync(join(tmpdir(), 'fcos-bootstrap-scope-'));
  try {
    mkdirSync(join(directory, 'controller/scripts'), { recursive: true });
    writeFileSync(join(directory, 'controller/scripts/hosted-release-manifest.mjs'),
      'import {writeFileSync} from "node:fs"; if(process.argv[2]!=="--validate-dispatch-only")process.exit(9);writeFileSync(process.env.ADMISSION_MARKER,"called");\n');
    const cases = [
      { plan: { stage: 'qualification' }, allowed: true },
      { resume: { stage: 'qualification', executionMode: 'qualification' }, allowed: true },
      { plan: { stage: 'application' }, allowed: false },
      { plan: { stage: 'qualification', executionMode: 'release' }, allowed: false },
      { resume: { stage: 'qualification', executionMode: 'release' }, allowed: false },
      { resume: { stage: 'compatibility', executionMode: 'qualification' }, allowed: false },
      { plan: { stage: 'qualification' }, resume: { stage: 'qualification', executionMode: 'qualification' }, allowed: false },
      { allowed: false },
    ];
    for (const [index, scenario] of cases.entries()) {
      const marker = join(directory, `admission-${index}`);
      const result = spawnSync('/bin/bash', ['-c', script], { cwd: directory, encoding: 'utf8', env: {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, ADMISSION_MARKER: marker,
        FCOS_RELEASE_PLAN: scenario.plan ? JSON.stringify(scenario.plan) : '',
        FCOS_RESUME_MANIFEST: scenario.resume ? JSON.stringify(scenario.resume) : '',
      } });
      assert.equal(result.status === 0, scenario.allowed, result.stderr);
      assert.equal(existsSync(marker), scenario.allowed);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test('actual rendered bootstrap wires exactly three public readback inputs to immutable GET-only carrier and preserves default qualification',()=>{
  const sha='f'.repeat(40),rendered=yaml.load(template.replaceAll('__FCOS_CONTROLLER_SHA__',sha)),input=rendered.on.workflow_dispatch.inputs,job=rendered.jobs.xero_owner_readback;
  assert.equal(input.bootstrap_phase.default,'qualification');assert.equal(input.xero_recovery_mode.default,'disabled');assert.deepEqual(input.xero_recovery_mode.options,['disabled','owner-readback','original-warm']);
  assert.equal(job.uses,`hocheunglai-oss/fcos/.github/workflows/hosted-xero-recovery-carrier.yml@${sha}`);assert.equal(job.with.controller_sha,sha);assert.equal(job.with.mode,'owner-readback');
  assert.equal(job.with.template_base64,'${{ inputs.xero_recovery_template_base64 }}');assert.equal(job.with.owner_readback_base64,'${{ inputs.xero_recovery_readback_base64 }}');
  assert.deepEqual(job.permissions,{contents:'read',actions:'read','id-token':'write'});assert.notEqual(job.secrets,'inherit');assert.deepEqual(Object.keys(job.secrets).sort(),['FCOS_HOSTED_VERCEL_READ_TOKEN','FCOS_HOSTED_RUNTIME_EMAIL','FCOS_HOSTED_RUNTIME_PASSWORD','FCOS_PRODUCTION_VERIFICATION_BYPASS','FCOS_XERO_RECOVERY_REQUEST_NONCE'].sort());
  const evaluate=(expression,inputs)=>Function('inputs','vars',`return (${expression.slice(3,-2)});`)(new Proxy(inputs,{get:(o,k)=>o[k]??''}),{FCOS_HOSTED_QUALIFICATION_ADMITTED:'true',FCOS_HOSTED_SETUP_DISCOVERY_ADMITTED:'true',FCOS_HOSTED_PRESERVATION_PREFLIGHT_ADMITTED:'true'});
  for(const mode of ['disabled','owner-readback','original-warm','submit','foreign'])for(const phase of input.bootstrap_phase.options){const inputs={bootstrap_phase:phase,xero_recovery_mode:mode,xero_recovery_template_base64:'SYNTHETIC-PUBLIC-TEMPLATE',xero_recovery_readback_base64:'SYNTHETIC-PUBLIC-READBACK'};
    assert.equal(evaluate(job.if,inputs),mode==='owner-readback'&&phase==='qualification');
    for(const [id,other]of Object.entries(rendered.jobs))if(!['xero_owner_readback','xero_original_warm'].includes(id))assert.equal(evaluate(other.if,inputs),mode==='disabled'&&phase===({toolchain:'toolchain',setup_discovery:'setup-discovery',preservation_preflight:'preservation-preflight',manifest:'qualification',release:'qualification'}[id]));
  }
  assert.equal(evaluate(job.if,{bootstrap_phase:'qualification',xero_recovery_mode:'owner-readback'}),false);
  const carrier=yaml.load(readFileSync(new URL('../.github/workflows/hosted-xero-recovery-carrier.yml',import.meta.url),'utf8')),step=carrier.jobs['xero-recovery-carrier'].steps.at(-1);
  assert.equal(step.env.FCOS_XERO_CARRIER_MODE,'${{ inputs.mode }}');assert.equal(step.env.FCOS_XERO_OWNER_READBACK_BASE64,'${{ inputs.owner_readback_base64 }}');assert.match(step.with.script,/carrierMain/);
});


test('original warm caller renders one hardcoded submit job from public root-installed variable, never dispatch template input',()=>{
  const sha='e'.repeat(40),rendered=yaml.load(template.replaceAll('__FCOS_CONTROLLER_SHA__',sha)),job=rendered.jobs.xero_original_warm;
  assert.equal(job.uses,`hocheunglai-oss/fcos/.github/workflows/hosted-xero-recovery-carrier.yml@${sha}`);
  assert.deepEqual(job.with,{controller_sha:sha,template_base64:'${{ vars.FCOS_XERO_ORIGINAL_CARRIER_TEMPLATE_BASE64 }}',mode:'submit'});
  assert.deepEqual(job.permissions,{contents:'read',actions:'read','id-token':'write'});assert.deepEqual(job.secrets,rendered.jobs.xero_owner_readback.secrets);
  assert.doesNotMatch(JSON.stringify(job),/inputs\.(?:plan|xero_recovery_template_base64|xero_recovery_readback_base64)/);
  assert.match(rendered['run-name'],/FCOS original Xero carrier/);assert.equal(Object.keys(rendered.on.workflow_dispatch.inputs).length,9);
  const evaluate=(inputs,vars)=>Function('inputs','vars',`return (${job.if.slice(3,-2)});`)(new Proxy(inputs,{get:(o,k)=>o[k]??''}),new Proxy(vars,{get:(o,k)=>o[k]??''}));
  const inputs={bootstrap_phase:'qualification',xero_recovery_mode:'original-warm',xero_original_warm_dispatch_id:'synthetic-public-correlation-only'};
  assert.equal(evaluate(inputs,{FCOS_XERO_ORIGINAL_CARRIER_TEMPLATE_BASE64:'public'}),true);
  for(const delta of [{xero_recovery_mode:'disabled'},{xero_recovery_mode:'owner-readback'},{xero_recovery_mode:'submit'},{bootstrap_phase:'toolchain'},{xero_original_warm_dispatch_id:''}])assert.equal(evaluate({...inputs,...delta},{FCOS_XERO_ORIGINAL_CARRIER_TEMPLATE_BASE64:'public'}),false);
  assert.equal(evaluate(inputs,{}),false);
});
