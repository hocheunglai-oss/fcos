import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { digest, targets } from '../scripts/lib/rapid-release/contract.mjs';
import { TRADING_FX_MIGRATIONS } from '../scripts/lib/rapid-release/trading-fx-migrations.mjs';
import { XERO_TRADING_FX_CHECKS, XERO_TRADING_FX_QUALIFICATION_ENVIRONMENT as environment,
  XERO_TRADING_FX_QUALIFICATION_TASK as task, verifyTradingFxXeroQualification } from '../scripts/lib/rapid-release/trading-fx-xero-qualification.mjs';

const pins = targets();
const repositoryUrl = `https://api.github.com/repos/${pins.repository}`;
const candidate = { sha: 'a'.repeat(40), sourceDigest: digest('source') };

function fixture() {
  const payload = { kind: 'fcos_trading_fx_xero_qualification', schemaVersion: 1, repository: pins.repository,
    candidateSha: candidate.sha, sourceDigest: candidate.sourceDigest, migrationDigest: digest(TRADING_FX_MIGRATIONS),
    testCompany: true, organisationEvidenceDigest: digest('native test organisation'), observedAt: '2026-11-11T12:00:00.250Z',
    checks: Object.fromEntries(XERO_TRADING_FX_CHECKS.map(key => [key, digest(key)])) };
  const record = { id: 17, creator: { id: 100, login: pins.account, type: 'User' }, environment, original_environment: environment,
    task, ref: candidate.sha, sha: candidate.sha, repository_url: repositoryUrl, production_environment: false,
    transient_environment: false, payload, created_at: '2026-11-11T12:00:00Z' };
  const repo = { full_name: pins.repository, archived: false, owner: { login: pins.account, id: 100 } };
  const calls = [];
  const options = {
    github: () => ({ async read(path) {
      calls.push(path);
      if (path === `/repos/${pins.repository}`) return repo;
      assert.equal(path, `/repos/${pins.repository}/deployments/17`);
      return record;
    } }),
    now: () => Date.parse('2026-11-11T12:01:00Z'),
  };
  const input = () => ({ manifest: { candidate }, env: {}, plan: {
    xeroQualificationDeploymentId: record.id, xeroQualificationDigest: digest(payload),
  } });
  return { record, repo, calls, options, input };
}

test('Trading FX verifies the original owner receipt with two read-only GitHub calls', async () => {
  const { input, options, calls } = fixture();
  const proof = await verifyTradingFxXeroQualification(input(), options);
  assert.deepEqual(calls, [`/repos/${pins.repository}`, `/repos/${pins.repository}/deployments/17`]);
  assert.deepEqual(proof, { verified: true, testCompany: true, candidateSha: candidate.sha,
    sourceDigest: candidate.sourceDigest, migrationDigest: digest(TRADING_FX_MIGRATIONS), evidenceDigest: input().plan.xeroQualificationDigest });
});

test('Trading FX rejects copied, incomplete or foreign qualification even with a matching payload digest', async () => {
  for (const change of [
    ({ record }) => { record.creator.id++; },
    ({ record }) => { record.creator.type = 'Bot'; },
    ({ record }) => { record.sha = 'b'.repeat(40); },
    ({ record }) => { record.production_environment = true; },
    ({ record }) => { record.payload.testCompany = false; },
    ({ record }) => { record.payload.sourceDigest = digest('foreign source'); },
    ({ record }) => { record.payload.migrationDigest = digest('foreign package'); },
    ({ record }) => { record.payload.observedAt = '2026-11-11T13:00:00Z'; },
    ({ record }) => { delete record.payload.checks.full_credit_recovery; },
    ({ record }) => { record.payload.checks.prepayment_refund = record.payload.checks.prepayment_reverse; },
    ({ record }) => { record.payload.extra = 'unreviewed evidence'; },
    ({ repo }) => { repo.archived = true; },
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(verifyTradingFxXeroQualification(f.input(), f.options), { code: 'TRADING_FX_XERO_QUALIFICATION_REQUIRED' });
  }
});

test('missing receipt locator stops before any lookup and changed evidence is denied', async () => {
  const { input, options, calls } = fixture();
  await assert.rejects(verifyTradingFxXeroQualification({ ...input(), plan: {} }, options),
    { code: 'TRADING_FX_XERO_QUALIFICATION_LOCATOR_REQUIRED' });
  assert.deepEqual(calls, []);
  const changed = input();
  changed.plan.xeroQualificationDigest = digest('other evidence');
  await assert.rejects(verifyTradingFxXeroQualification(changed, options), { code: 'TRADING_FX_XERO_QUALIFICATION_REQUIRED' });
});

test('local controller registration binds the exact combined adapter and deferred-stage exports', async () => {
  const root = new URL('../', import.meta.url);
  const registry = JSON.parse(await readFile(new URL('config/rapid-release-adapters.json', root), 'utf8'));
  const entry = registry.adapters.find(item => item.id === 'trading-fx-prerequisites');
  const adapterUrl = new URL(entry.path, root);
  assert.equal(entry.sourceDigest, digest(await readFile(adapterUrl)));
  assert.equal(entry.status, 'qualified');
  assert.equal(entry.supportsDeferredStage, true);
  assert.equal(entry.salesforce && entry.database && entry.databaseWrite, true);
  const adapter = await import(adapterUrl.href);
  assert.equal(typeof adapter.verifyPreBootstrapStage, 'function');
  assert.equal(typeof adapter.applyReviewedPrerequisites, 'function');
});
