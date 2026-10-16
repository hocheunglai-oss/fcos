import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { collectProjectDoctor } from '../scripts/fcos-project-doctor.mjs';

test('project doctor validates controls and reports non-secret CLI-first project facts', () => {
  const report = collectProjectDoctor();
  assert.equal(report.mode, 'controls');
  assert.equal(report.controls.verified, true);
  assert.equal(report.identities.github.repository, 'hocheunglai-oss/fcos');
  assert.equal(report.identities.vercel.target, 'hocheunglai-6535s-projects/fcos');
  assert.equal(report.identities.supabase.projectRef, 'pjforfvchygdyqfcgpmw');
  assert.equal(report.identities.salesforce.sourceEnvironment, 'devee');
  assert.equal(typeof report.source.head, 'string');
  assert.equal(typeof report.source.worktree.dirty, 'boolean');
  assert.deepEqual(report.commands.projectEntrypoints.map(({ available }) => available), [true, true, true]);
  assert.deepEqual(report.commands.cli.map(({ command }) => command), ['gh', 'vercel', 'supabase', 'sf']);
});

test('release readiness reports the exact local candidate and remaining external evidence without contacting providers', () => {
  const output = execFileSync(process.execPath, ['scripts/fcos-project-doctor.mjs', '--release-readiness'], { cwd: process.cwd(), encoding: 'utf8' });
  const report = JSON.parse(output);
  assert.equal(report.mode, 'release-readiness');
  assert.equal(report.releaseReadiness.candidate, report.source.head);
  assert.equal(report.releaseReadiness.status, 'evidence_required');
  assert.equal(report.releaseReadiness.blockers.length, 3);
});

test('doctor implementation does not write files or make network requests', async () => {
  const source = await readFile(new URL('../scripts/fcos-project-doctor.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /writeFile|appendFile|fetch\s*\(/);
});
