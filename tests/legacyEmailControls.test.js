import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { releaseConfigurationRevision } from '../scripts/lib/release-readiness.mjs';

// A candidate cannot replace the protected verifier policy through an old or
// modified checkout. Its application/dependency configuration still binds.
test('release configuration binds protected controls independently from candidate configuration', () => {
  const root = mkdtempSync(join(tmpdir(), 'fcos-email-controls-'));
  const candidate = join(root, 'candidate'), trusted = join(root, 'trusted');
  function put(directory, path, value) {
    mkdirSync(join(directory, path.split('/').slice(0, -1).join('/')), { recursive: true });
    writeFileSync(join(directory, path), value);
  }
  try {
    put(candidate, 'package-lock.json', 'candidate-lock');
    put(candidate, 'vercel.json', 'candidate-routing');
    put(candidate, 'config/preview-parity-policy.json', 'old-candidate-policy');
    put(trusted, 'config/preview-parity-policy.json', 'reviewed-policy');
    put(trusted, 'config/legacy-email-baseline-proof.json', 'reviewed-contract');
    put(trusted, 'scripts/lib/preview-email-signer.mjs', 'reviewed-signer');
    const initial = releaseConfigurationRevision(candidate, trusted);
    put(candidate, 'config/preview-parity-policy.json', 'caller-expanded-policy');
    assert.equal(releaseConfigurationRevision(candidate, trusted), initial);
    put(trusted, 'config/legacy-email-baseline-proof.json', 'expanded-contract');
    const changedContract = releaseConfigurationRevision(candidate, trusted);
    assert.notEqual(changedContract, initial);
    put(candidate, 'package-lock.json', 'different-lock');
    const changedLock = releaseConfigurationRevision(candidate, trusted);
    assert.notEqual(changedLock, changedContract);
    put(trusted, 'scripts/lib/preview-email-signer.mjs', 'different-signer');
    assert.notEqual(releaseConfigurationRevision(candidate, trusted), changedLock);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
