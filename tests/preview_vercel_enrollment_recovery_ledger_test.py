import concurrent.futures
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('recovery_ledger', ROOT / 'scripts/lib/preview-vercel-enrollment-recovery-ledger.py')
ledger = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ledger)

class RecoveryLedgerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='fcos-recovery-ledger-')
        self.directory = Path(self.temp.name).resolve()
        self.workflow = self.directory / 'workflow-state.json'
        fixtures = ROOT / 'tests/fixtures/preview-email-coordination-ledger'
        self.helper = fixtures / 'coordinator_guard.py'
        self.guard = ledger.load_guard(self.helper)
        helper = {'path': str(self.helper), 'sha256': ledger.HELPER_SHA256,
            'localCoordinationGuardAccepted': True, 'independentReviewPending': False, 'providerAuthority': False,
            'rootAcceptance': {'path': str(fixtures / 'root-acceptance.json'), 'sha256': 'e498d78f785362f36853be46a925416359c2f06e71422d61feaca89d194150b4'},
            'independentRevisionReview': {'path': str(fixtures / 'independent-review.json'), 'sha256': '03c5a3bb8dc7e98896e4493edef9992573cfd8663d38cc3e1001fd71c59372d9'}}
        self.state = {'unifiedCoordinator': {'status': 'active', 'epoch': 'production-reconciliation-20261005',
            'writeLeasePath': str(self.directory / 'live-provider-write-lease.json'), 'writeLeaseHelper': helper,
            'objectives': {'production': {'ownerThreadId': ledger.OWNER, 'retired': False, 'status': 'active'}}}}
        self.workflow.write_text(json.dumps(self.state))
        self.binding = {'operationId': 'fcos-preview-enrollment-recovery-22222222-2222-4222-8222-222222222222', 'source': 'SYNTHETIC', 'nonce': '11111111-1111-4111-8111-111111111111'}

    def tearDown(self):
        self.temp.cleanup()

    def consume(self, binding=None):
        return ledger.claim_and_consume(json.dumps(binding or self.binding, separators=(',', ':')), self.workflow,
            self.directory, self.helper, fixture=True)

    def test_exclusive_fsynced_intent_and_canonical_lease_precede_return(self):
        with patch.object(os, 'fsync', wraps=os.fsync) as sync:
            result = self.consume()
        self.assertGreaterEqual(sync.call_count, 5)
        path = self.directory / 'preview-enrollment-recovery-consumption' / (hashlib.sha256(self.binding['operationId'].encode()).hexdigest() + '.json')
        record = json.loads(path.read_bytes())
        self.assertEqual(result['consumptionSha256'], hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertEqual(record['lease'], json.loads((self.directory / 'live-provider-write-lease.json').read_bytes()))
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertTrue(record['replayForbidden'])
        self.assertFalse(record['providerAuthorityGranted'])
        with self.assertRaisesRegex(ValueError, 'permanently consumed'):
            self.consume()

    def test_changed_source_or_expiry_cannot_replay_after_root_resolves_original_lease(self):
        result = self.consume()
        lease = result['lease']
        proof = {'kind': 'reviewed_coordinator_write_resolution_v1', **{key: lease[key] for key in
            ['epoch', 'ownerThreadId', 'operationId', 'bindingSha256', 'leaseId']}, 'outcome': 'verified_no_provider_submission',
            'releaseOwnerMaterialAcceptance': 'TEMP SYNTHETIC REVIEW', 'actualActionReadbackProofs': ['TEMP GET-ONLY PROOF']}
        path = self.directory / 'resolution.json'
        self.guard.create_json(path, proof)
        self.guard.WriteLease(self.workflow, self.directory).resolve(lease, path, hashlib.sha256(path.read_bytes()).hexdigest())
        with self.assertRaisesRegex(ValueError, 'permanently consumed'):
            self.consume({**self.binding, 'source': 'CHANGED', 'expiresAt': 9999999999999})
        self.assertFalse((self.directory / 'live-provider-write-lease.json').exists())

    def test_nonce_cannot_replay_with_new_operation_after_root_resolution(self):
        result = self.consume()
        lease = result['lease']
        proof = {'kind': 'reviewed_coordinator_write_resolution_v1', **{key: lease[key] for key in
            ['epoch', 'ownerThreadId', 'operationId', 'bindingSha256', 'leaseId']}, 'outcome': 'verified_no_provider_submission',
            'releaseOwnerMaterialAcceptance': 'TEMP SYNTHETIC REVIEW', 'actualActionReadbackProofs': ['TEMP GET-ONLY PROOF']}
        path = self.directory / 'resolution.json'
        self.guard.create_json(path, proof)
        self.guard.WriteLease(self.workflow, self.directory).resolve(lease, path, hashlib.sha256(path.read_bytes()).hexdigest())
        with self.assertRaisesRegex(ValueError, 'nonce permanently consumed'):
            self.consume({**self.binding, 'operationId': 'fcos-preview-enrollment-recovery-33333333-3333-4333-8333-333333333333'})

    def test_read_consumed_requires_original_current_lease_and_both_permanent_records(self):
        result = self.consume()
        read = lambda: ledger.read_consumed(self.binding['nonce'], self.workflow, self.directory, self.helper, fixture=True)
        self.assertEqual(read(), result)
        lease_path = self.directory / 'live-provider-write-lease.json'
        raw = lease_path.read_bytes()
        lease_path.write_text(json.dumps({**result['lease'], 'leaseId': '33333333-3333-4333-8333-333333333333'}))
        with self.assertRaises(ValueError):
            read()
        lease_path.write_bytes(raw)
        path = self.directory / 'preview-enrollment-recovery-consumption' / (hashlib.sha256(self.binding['operationId'].encode()).hexdigest() + '.json')
        path.write_text(json.dumps({**json.loads(path.read_bytes()), 'binding': {**self.binding, 'source': 'CHANGED'}}))
        with self.assertRaises(ValueError):
            read()

    def test_current_retirement_reassignment_or_stopped_objective_revokes_retained_lease(self):
        self.consume()
        for scope, field, value in [('coordinator', 'status', 'retired'), ('production', 'status', 'paused'),
                                   ('production', 'retired', True), ('production', 'ownerThreadId', 'FOREIGN')]:
            changed = json.loads(json.dumps(self.state))
            selected = changed['unifiedCoordinator'] if scope == 'coordinator' else changed['unifiedCoordinator']['objectives']['production']
            selected[field] = value
            self.workflow.write_text(json.dumps(changed))
            with self.assertRaises(ValueError):
                ledger.read_consumed(self.binding['nonce'], self.workflow, self.directory, self.helper, fixture=True)
        self.workflow.write_text(json.dumps(self.state))

    def test_one_winner_under_concurrent_consumption(self):
        # Precreate only the private temp ledger; the real canonical helper owns
        # race serialization and O_EXCL. No provider or credential call occurs.
        (self.directory / 'preview-enrollment-recovery-consumption').mkdir(mode=0o700)
        def attempt(_):
            try:
                self.consume()
                return True
            except (ValueError, FileExistsError):
                return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            self.assertEqual(sum(pool.map(attempt, range(6))), 1)

    def test_crash_after_lease_claim_retains_lease(self):
        real_create = self.guard.create_json
        def crash(path, value):
            if Path(path).parent.name == 'preview-enrollment-recovery-consumption':
                raise OSError('SYNTHETIC CRASH')
            return real_create(path, value)
        with patch.object(ledger, 'load_guard', return_value=self.guard), patch.object(self.guard, 'create_json', side_effect=crash):
            with self.assertRaises(OSError):
                self.consume()
        self.assertTrue((self.directory / 'live-provider-write-lease.json').exists())
        with self.assertRaises(FileExistsError):
            self.consume()

    def test_fixture_paths_cannot_target_actual_canonical_state(self):
        with self.assertRaises(ValueError):
            ledger.claim_and_consume(json.dumps(self.binding), ledger.WORKFLOW, ledger.BASE, ledger.HELPER, fixture=True)
        with self.assertRaises(ValueError):
            ledger.claim_and_consume(None, ledger.WORKFLOW, ledger.BASE, ledger.HELPER, nonce='not-an-approval')

    def test_changed_helper_or_acceptance_fails_before_lease(self):
        helper = self.directory / 'changed-helper.py'
        helper.write_bytes(self.helper.read_bytes() + b'\n# changed\n')
        with self.assertRaises(ValueError):
            ledger.claim_and_consume(json.dumps(self.binding), self.workflow, self.directory, helper, fixture=True)
        self.state['unifiedCoordinator']['writeLeaseHelper']['rootAcceptance']['sha256'] = '0' * 64
        self.workflow.write_text(json.dumps(self.state))
        with self.assertRaises(ValueError):
            self.consume()
        self.assertFalse((self.directory / 'live-provider-write-lease.json').exists())

    def test_raw_source_requires_exact_actual_draft_head_tree_mode_and_all_new_helpers(self):
        root = self.directory / 'source'
        root.mkdir()
        rows = []
        a = {'sourcePullRequest': 999, 'sourceCommit': 'a' * 40, 'sourceTree': 'b' * 40,
            'protectedMainSha': 'c' * 40, 'sourceBranch': 'codex/synthetic'}
        for key, relative in [('scriptSha256', ledger.CLI), ('librarySha256', ledger.LIBRARY), ('ledgerSha256', ledger.LEDGER), ('unusedVercelSha256', 'vercel.json')]:
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(('SYNTHETIC ' + relative).encode())
            a[key] = hashlib.sha256(path.read_bytes()).hexdigest()
            raw = path.read_bytes()
            rows.append({'path': relative, 'type': 'blob', 'mode': '100644', 'sha': hashlib.sha1(('blob ' + str(len(raw)) + '\0').encode() + raw).hexdigest()})
        repo = {'full_name': 'hocheunglai-oss/fcos', 'default_branch': 'main', 'owner': {'id': 1}, 'permissions': {'admin': True}}
        remote = {'user': {'login': 'hocheunglai-oss', 'id': 1}, 'repository': repo,
            'branch': {'name': 'main', 'protected': True, 'commit': {'sha': a['protectedMainSha']}},
            'protection': {'enforce_admins': {'enabled': True}, 'required_status_checks': {'strict': True}},
            'pr': {'number': 999, 'draft': True, 'state': 'open', 'user': {'login': 'hocheunglai-oss'},
                'head': {'repo': repo, 'ref': a['sourceBranch'], 'sha': a['sourceCommit']},
                'base': {'repo': repo, 'ref': 'main', 'sha': a['protectedMainSha']}},
            'commit': {'sha': a['sourceCommit'], 'tree': {'sha': a['sourceTree']}},
            'tree': {'sha': a['sourceTree'], 'truncated': False, 'tree': rows}}
        ledger.assert_raw_source(root, a, remote)
        for field in ['draft', 'head']:
            changed = json.loads(json.dumps(remote))
            if field == 'draft':
                changed['pr']['draft'] = False
            else:
                changed['pr']['head']['sha'] = 'f' * 40
            with self.assertRaises(ValueError):
                ledger.assert_raw_source(root, a, changed)
        (root / ledger.CLI).write_bytes(b'UNREVIEWED')
        with self.assertRaises(ValueError):
            ledger.assert_raw_source(root, a, remote)

if __name__ == '__main__':
    unittest.main()
