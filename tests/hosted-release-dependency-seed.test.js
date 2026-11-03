import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DEPENDENCY_SEED_FILES, sealDependencySeed } from '../scripts/hosted-release-dependency-seed.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const candidateSha = 'c'.repeat(40), credentialSha256 = 'a'.repeat(64);
const files = DEPENDENCY_SEED_FILES.map((path, index) => ({ path, bytes: Buffer.from(`synthetic-${index}`) }));
const yaml = createRequire(import.meta.url)('js-yaml');

test('sealed dependency archive is public ciphertext with an exact encrypted descriptor binding', () => {
  const receiver = createECDH('prime256v1'); receiver.generateKeys();
  const bytes = sealDependencySeed({ files, candidateSha, recipientPublicKey: receiver.getPublicKey().toString('base64'), credentialSha256 });
  const envelope = JSON.parse(bytes);
  assert.equal(envelope.kind, 'fcos_hosted_dependency_archive_v1');
  assert.equal(envelope.context.repository, 'hocheunglai-oss/fcos');
  assert.equal(envelope.context.candidateSha, candidateSha);
  assert.equal(envelope.context.credentialSha256, credentialSha256);
  assert.equal(envelope.context.recipientPublicKeySha256, sha(receiver.getPublicKey()));
  assert.equal(envelope.context.filesSha256.length, 64);
  assert.equal(bytes.includes(files[0].bytes), false);
  assert.equal(envelope.salt.length > 0 && envelope.iv.length > 0 && envelope.tag.length > 0 && envelope.ephemeralPublicKey.length > 0, true);
});

test('sealing rejects incomplete exact12 payloads and invalid receiver bindings', () => {
  const receiver = createECDH('prime256v1'); receiver.generateKeys();
  assert.throws(() => sealDependencySeed({ files: files.slice(1), candidateSha, recipientPublicKey: receiver.getPublicKey().toString('base64'), credentialSha256 }));
  assert.throws(() => sealDependencySeed({ files, candidateSha, recipientPublicKey: 'invalid', credentialSha256 }));
  assert.throws(() => sealDependencySeed({ files, candidateSha: 'bad', recipientPublicKey: receiver.getPublicKey().toString('base64'), credentialSha256 }));
});

test('only trusted dependency consumers open the ciphertext before existing loaders', () => {
  const workflow = yaml.load(readFileSync(new URL('../.github/workflows/hosted-release-controller.yml', import.meta.url), 'utf8'));
  const jobs = ['dependencies_before', 'publish_before', 'dependencies_after', 'publish_after'];
  for (const id of jobs) {
    const steps = workflow.jobs[id].steps, open = steps.findIndex(step => step.name === 'Open admitted dependency seed');
    const run = steps.findIndex(step => step.name === 'Run admitted checks');
    assert.ok(open >= 0 && open < run, id);
    const step = steps[open];
    assert.equal(step.run, 'node controller/scripts/hosted-release-dependency-seed.mjs --open');
    assert.equal(step.env.FCOS_HOSTED_DEPENDENCY_SETUP_DIRECTORY, 'dependency-setup');
    assert.equal(step.env.FCOS_HOSTED_DEPENDENCY_SETUP_OPENED_DIRECTORY, 'dependency-setup-opened');
    assert.equal(workflow.jobs[id].env.FCOS_HOSTED_DEPENDENCY_SETUP_DIRECTORY, 'dependency-setup-opened');
  }
});
