import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { SOURCE_ROOT, FIXTURE_ROOT, sourceBindings, copyBoundSource } from './helpers/runtimeCompatibilitySuccessorPortable.mjs';

// Historical live-admission guards must execute against their exact retained
// control bytes. Running changed installation controls as that old harness is
// correctly refused by the unchanged executing-source guard.
test('historical successor live checks execute in the exact retained offline harness', t => {
  const directory = mkdtempSync(join(tmpdir(), 'fcos-retained-live-suite-'));
  try {
    for (const { path } of sourceBindings.sources) copyBoundSource(directory, path);
    for (const path of ['tests/helpers/runtimeCompatibilitySuccessorPortable.mjs', 'tests/helpers/runtimeMaterialTransport.mjs', 'tests/helpers/runtimeCompatibilityHistoricalNoProviders.mjs',
      'tests/fixtures/preview-verification-actual-github.json', 'tests/runtimeCompatibilitySuccessorLive.historical.mjs']) {
      const target = join(directory,path); mkdirSync(dirname(target),{recursive:true}); copyFileSync(join(SOURCE_ROOT,path),target);
    }
    cpSync(FIXTURE_ROOT,join(directory,'tests/fixtures/runtime-compatibility-successor-integration'),{recursive:true});
    // Locked installed dependencies only; this directory is not a candidate or
    // an admitted Git checkout and has no credentials or deployment authority.
    symlinkSync(join(SOURCE_ROOT,'node_modules'),join(directory,'node_modules'),'dir');
    const source = readFileSync(join(directory,'tests/runtimeCompatibilitySuccessorLive.historical.mjs'));
    assert.equal(createHash('sha256').update(source).digest('hex'), '9a76061a46773c0b1ffdd3d86dbfb08d730387ce0c80fab24118b34a86ff8dfc');
    const temporary = join(directory,'tmp'); mkdirSync(temporary);
    const child = spawnSync(process.execPath,['--import',join(directory,'tests/helpers/runtimeCompatibilityHistoricalNoProviders.mjs'),'--test-reporter=tap',join(directory,'tests/runtimeCompatibilitySuccessorLive.historical.mjs')],{
      cwd:directory,env:{PATH:process.env.PATH,TMPDIR:temporary},encoding:'utf8',timeout:300000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe'],
    });
    t.diagnostic(child.stdout || 'No historical TAP emitted.');
    if (child.stderr) t.diagnostic(child.stderr);
    assert.ifError(child.error); assert.equal(child.signal,null); assert.equal(child.status,0,'Historical child failed; no live authority is granted.');
    const lines = child.stdout.split(/\r?\n/);
    for (const line of ['# fail 0','# skipped 0','# todo 0']) assert.ok(lines.includes(line),`Missing child summary: ${line}`);
    for (const line of ['# tests 48','# pass 48']) assert.ok(lines.includes(line),`All48 original cases must execute: ${line}`);
    assert.ok(lines.includes('# historical_provider_transport_attempts 0'),'No unexpected provider transport is permitted.');
  } finally { rmSync(directory,{recursive:true,force:true}); }
});
