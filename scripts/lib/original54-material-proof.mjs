// Local material evidence, never a hosted check or financial execution grant.
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { isCredentialPath } from './build-provenance.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const seed = 'bb1347c0917102e5ea1917446d6b5970865403c6f2d63931d7451246e90dfb82';
const fail = () => { throw new Error('ORIGINAL54_EXACT_CANDIDATE_PRIVATE_MATERIAL_PROOF_REQUIRED'); };
export function collectOriginal54CandidateBinding(candidateDirectory, candidateCommit) {
  const root = path.resolve(candidateDirectory);
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const candidateTree = git(['rev-parse', `${candidateCommit}^{tree}`]).trim();
  const sourceFiles = git(['ls-tree', '-r', '-z', candidateCommit]).split('\0').filter(Boolean).map(row => {
    const split = row.indexOf('\t'), [mode, type, blob] = row.slice(0, split).split(' '), name = row.slice(split + 1);
    const target = path.resolve(root, name);
    if (!target.startsWith(root + path.sep) || type !== 'blob' || isCredentialPath(name)) fail();
    const stat = lstatSync(target), bytes = readFileSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || mode !== (stat.mode & 0o111 ? '100755' : '100644')
      || createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== blob) fail();
    return { path: name, mode, blob, sha256: hash(bytes) };
  });
  return { candidateTree, sourceFiles };
}
export function assertOriginal54MaterialProof({ proofPath, proofSha256, candidateCommit, candidateDirectory = process.cwd(), candidateTree, sourceFiles }) {
  if (!proofPath || !/^[a-f0-9]{64}$/.test(proofSha256 || '') || !/^[a-f0-9]{40}$/.test(candidateCommit || '')) fail();
  const bytes = readFileSync(proofPath);
  if (hash(bytes) !== proofSha256) fail();
  const p = JSON.parse(bytes);
  if (sourceFiles === undefined) ({ candidateTree, sourceFiles } = collectOriginal54CandidateBinding(candidateDirectory, candidateCommit));
  if (!/^[a-f0-9]{40}$/.test(candidateTree || '')) fail();
  if (p.kind !== 'actual_private_original54_source_material_test_proof_v1' || p.accepted !== true || p.sourceUnchanged !== true
    || p.sourceCommit !== candidateCommit || p.tree !== candidateTree || p.seedSha256 !== seed || p.originalRecords !== 54
    || JSON.stringify(p.command?.slice(1)) !== JSON.stringify(['--test','--test-reporter=tap','tests/xeroExistingDraftAuthorisationDatabase.private54.test.mjs','tests/xeroExistingDraftQuotaDatabase.private54.test.mjs'])
    || p.exitCode !== 0 || p.counts?.tests < 50 || p.counts?.tests !== p.counts?.pass || p.counts?.fail !== 0 || p.counts?.skipped !== 0 || p.counts?.cancelled !== 0
    || p.hostedCheck !== false || p.providerCalls !== 0 || p.financialActions !== 0 || p.privateSeedExported !== false
    || !/^postgres \(PostgreSQL\) 17\.11(?:\s|$)/.test(p.postgresVersion || '')
    || !Array.isArray(sourceFiles) || sourceFiles.length === 0 || JSON.stringify(p.sourceFiles) !== JSON.stringify(sourceFiles)
    || !Number.isFinite(Date.parse(p.startedAt)) || !Number.isFinite(Date.parse(p.completedAt)) || Date.parse(p.completedAt) < Date.parse(p.startedAt)) fail();
  return Object.freeze({ kind: p.kind, proofSha256, candidateCommit, candidateTree, counts: p.counts, hostedCheck: false });
}
