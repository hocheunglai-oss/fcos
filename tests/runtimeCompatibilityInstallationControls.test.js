import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SOURCE_ROOT, installationControls, installationControlSource, assertBoundSource, hash } from './helpers/runtimeCompatibilitySuccessorPortable.mjs';

test('reviewed installation bytes use exact retained historical controls without accepting arbitrary current drift', () => {
  assert.equal(installationControls.sources.length,8);
  for (const entry of installationControls.sources) {
    const current = readFileSync(join(SOURCE_ROOT,entry.path));
    assert.equal(hash(current),entry.currentSha256);
    const historical = installationControlSource(entry.path,current);
    assert.equal(hash(historical),entry.sha256); assertBoundSource(entry.path,historical);
    assert.notEqual(hash(historical),hash(current));
    assert.throws(()=>installationControlSource(entry.path,Buffer.concat([current,Buffer.from('\n')])),/Unreviewed current installation control/);
    historical[0] ^= 1;
    assert.equal(hash(installationControlSource(entry.path,current)),entry.sha256,'Returned buffers cannot alter retained evidence.');
  }
});

test('offline child admits only its exact local archive command and still refuses provider transport', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const root = mkdtempSync(join(tmpdir(),'fcos-archive-guard-test-'));
  const directory = join(root,'fcos-original-intent-fixture'); mkdirSync(directory);
  writeFileSync(join(directory,'fcos-preview-email-intent.json'),'{"fixture":true}\n');
  const guard = join(SOURCE_ROOT,'tests/helpers/runtimeCompatibilityHistoricalNoProviders.mjs');
  try {
    const archiveHelper = new URL('../scripts/lib/release-evidence.mjs', import.meta.url).href;
    const code = `import {execFileSync} from 'node:child_process';import{readFileSync}from'node:fs';import{readEvidenceArchive}from${JSON.stringify(archiveHelper)};execFileSync('/usr/bin/zip',['-q','archive.zip','fcos-preview-email-intent.json'],{cwd:process.argv[1]});if(readEvidenceArchive(readFileSync(process.argv[1]+'/archive.zip'),'fcos-preview-email-intent.json').fixture!==true)throw Error('ARCHIVE_FIXTURE_INVALID');`;
    const child = spawnSync(process.execPath,['--import',guard,'--input-type=module','-e',code,directory],{env:{PATH:process.env.PATH,TMPDIR:root},encoding:'utf8'});
    assert.equal(child.status,0); assert.match(child.stdout,/# historical_provider_transport_attempts 0/);
    assert.deepEqual([...readFileSync(join(directory,'archive.zip')).subarray(0,4)],[80,75,3,4]);
    const denied = spawnSync(process.execPath,['--import',guard,'--input-type=module','-e',"try {await fetch('https://unexpected.invalid/');} catch {}"],{env:{PATH:process.env.PATH,TMPDIR:root},encoding:'utf8'});
    assert.equal(denied.status,1); assert.match(denied.stdout,/# historical_provider_transport_attempts 1/);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
