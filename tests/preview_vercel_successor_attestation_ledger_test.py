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
spec = importlib.util.spec_from_file_location('attestation_ledger', ROOT / 'scripts/lib/preview-vercel-successor-attestation-ledger.py')
ledger = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ledger)
NONCE = '11111111-1111-4111-8111-111111111111'

class ExistingAttestationConsumptionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='fcos-existing-attestation-ledger-')
        self.directory = Path(self.temp.name).resolve()
        self.workflow = self.directory / 'workflow-state.json'
        fixtures = ROOT / 'tests/fixtures/preview-email-coordination-ledger'
        self.helper = fixtures / 'coordinator_guard.py'
        self.guard = ledger.load_guard(self.helper)
        helper = {'path': str(self.helper), 'sha256': ledger.HELPER_SHA256,
            'localCoordinationGuardAccepted': True, 'independentReviewPending': False, 'providerAuthority': False,
            'rootAcceptance': {'path': str(fixtures / 'root-acceptance.json'),
                'sha256': 'e498d78f785362f36853be46a925416359c2f06e71422d61feaca89d194150b4'},
            'independentRevisionReview': {'path': str(fixtures / 'independent-review.json'),
                'sha256': '03c5a3bb8dc7e98896e4493edef9992573cfd8663d38cc3e1001fd71c59372d9'}}
        self.state = {'unifiedCoordinator': {'status': 'active', 'epoch': 'production-reconciliation-20261005',
            'writeLeasePath': str(self.directory / 'live-provider-write-lease.json'), 'writeLeaseHelper': helper,
            'objectives': {'production': {'ownerThreadId': ledger.OWNER, 'retired': False, 'status': 'active'}}}}
        self.save()
        self.actual = {'operationId': 'fcos-preview-vercel-attestation-99-' + NONCE,
            'runId': 99, 'actionSha256': 'a' * 64, 'secretMetadata': ['SYNTHETIC_NONSECRET_METADATA']}

    def tearDown(self):
        self.temp.cleanup()

    def save(self):
        self.workflow.write_text(json.dumps(self.state))

    def consume(self, actual=None, nonce=NONCE):
        return ledger.claim_and_consume(actual or self.actual, self.workflow, self.directory, self.helper, fixture=True, nonce=nonce)

    def test_native_exclusive_intent_file_and_directory_fsync_precede_return(self):
        with patch.object(os, 'fsync', wraps=os.fsync) as sync:
            result = self.consume()
        self.assertGreaterEqual(sync.call_count, 5)
        path = ledger.ledger_path(self.directory, NONCE)
        record = json.loads(path.read_bytes())
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(record['actual'], self.actual)
        self.assertEqual(result['consumptionSha256'], hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertEqual(record['lease'], json.loads((self.directory / 'live-provider-write-lease.json').read_bytes()))
        self.assertTrue(record['possibleSigningOrPublication'])
        self.assertTrue(record['replayForbidden'])
        self.assertFalse(record['providerAuthorityGranted'])
        self.assertEqual(result['lease']['bindingSha256'], ledger.digest(ledger.DOMAIN + ledger.encoded(self.actual)))
        with self.assertRaisesRegex(ValueError, 'permanently consumed'):
            self.consume()

    def test_same_nonce_changed_run_or_source_cannot_reissue_after_root_resolves_lease(self):
        result = self.consume()
        lease = result['lease']
        proof = {'kind': 'reviewed_coordinator_write_resolution_v1', **{key: lease[key] for key in
            ['epoch', 'ownerThreadId', 'operationId', 'bindingSha256', 'leaseId']},
            'outcome': 'verified_no_provider_submission', 'releaseOwnerMaterialAcceptance': 'TEMP OFFLINE ROOT RESOLUTION',
            'actualActionReadbackProofs': ['TEMP OFFLINE NO SUBMISSION']}
        path = self.directory / 'root-resolution.json'
        self.guard.create_json(path, proof)
        self.guard.WriteLease(self.workflow, self.directory).resolve(lease, path, ledger.digest(path.read_bytes()))
        changed = {**self.actual, 'operationId': 'fcos-preview-vercel-attestation-100-' + NONCE, 'runId': 100, 'actionSha256': 'b' * 64}
        with self.assertRaisesRegex(ValueError, 'permanently consumed'):
            self.consume(changed)
        self.assertFalse((self.directory / 'live-provider-write-lease.json').exists())
        self.assertEqual(len(list((self.directory / ledger.LEDGER_NAME).glob('*.json'))), 1)

    def test_uncertain_delivery_or_crash_keeps_consumed_nonce_and_original_shared_lease(self):
        result = self.consume()
        with self.assertRaises(ValueError):
            self.consume({**self.actual, 'privateReadinessAt': 1, 'expiresAt': 1})
        self.assertEqual(json.loads((self.directory / 'live-provider-write-lease.json').read_bytes()), result['lease'])
        self.assertTrue(ledger.ledger_path(self.directory, NONCE).exists())
        with patch.object(ledger, 'BASE', self.directory), patch.object(ledger, 'WORKFLOW', self.workflow), patch.object(ledger, 'HELPER', self.helper):
            self.assertEqual(ledger.read_consumed(NONCE), result)
            changed_lease = {**result['lease'], 'leaseId': '22222222-2222-4222-8222-222222222222'}
            (self.directory / 'live-provider-write-lease.json').write_text(json.dumps(changed_lease))
            with self.assertRaisesRegex(ValueError, 'retained lease'):
                ledger.read_consumed(NONCE)

    def test_fsync_consumption_failure_retains_shared_lease_and_never_retries(self):
        original = self.guard.create_json
        def fail_intent(path, value):
            if Path(path).parent.name == ledger.LEDGER_NAME:
                raise OSError('OFFLINE uncertain fsync')
            return original(path, value)
        with patch.object(ledger, 'load_guard', return_value=self.guard), patch.object(self.guard, 'create_json', side_effect=fail_intent):
            with self.assertRaises(OSError):
                self.consume()
        self.assertTrue((self.directory / 'live-provider-write-lease.json').exists())
        with self.assertRaises(FileExistsError):
            self.consume()

    def test_inflight_consumption_refuses_revoked_objective_without_releasing_or_renewing(self):
        result = self.consume()
        coordinator = self.state['unifiedCoordinator']
        objective = coordinator['objectives']['production']
        with patch.object(ledger, 'BASE', self.directory), patch.object(ledger, 'WORKFLOW', self.workflow), patch.object(ledger, 'HELPER', self.helper):
            for target, key, value in [(coordinator, 'status', 'stopped'), (objective, 'status', 'waiting_human'),
                    (objective, 'retired', True), (objective, 'ownerThreadId', 'FOREIGN_OWNER')]:
                original = target[key]
                target[key] = value
                self.save()
                with self.assertRaisesRegex(ValueError, 'current accepted canonical helper'):
                    ledger.read_consumed(NONCE)
                self.assertEqual(json.loads((self.directory / 'live-provider-write-lease.json').read_bytes()), result['lease'])
                target[key] = original
                self.save()
            self.assertEqual(ledger.read_consumed(NONCE), result)

    def test_concurrent_issuers_have_one_permanent_winner(self):
        def attempt():
            try:
                return self.consume()
            except (ValueError, FileExistsError):
                return None
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: attempt(), range(2)))
        self.assertEqual(sum(result is not None for result in results), 1)
        self.assertEqual(len(list((self.directory / ledger.LEDGER_NAME).glob('*.json'))), 1)

    def test_wrong_helper_review_epoch_and_foreign_paths_fail_before_claim(self):
        for key, value in [('epoch', 'retired'), ('writeLeasePath', 'foreign')]:
            current = self.state['unifiedCoordinator'][key]
            self.state['unifiedCoordinator'][key] = value
            self.save()
            with self.assertRaises(ValueError):
                self.consume()
            self.assertFalse((self.directory / 'live-provider-write-lease.json').exists())
            self.state['unifiedCoordinator'][key] = current
        self.save()
        modified = self.directory / 'modified-helper.py'
        modified.write_bytes(self.helper.read_bytes() + b'\n')
        with self.assertRaisesRegex(ValueError, 'changed'):
            ledger.load_guard(modified)
        with self.assertRaisesRegex(ValueError, 'temporary'):
            ledger.claim_and_consume(self.actual, ledger.WORKFLOW, ledger.BASE, ledger.HELPER, fixture=True, nonce=NONCE)
        with self.assertRaisesRegex(ValueError, 'fixed actual'):
            ledger.claim_and_consume(self.actual, self.workflow, self.directory, self.helper, nonce=NONCE)
        with self.assertRaisesRegex(ValueError, 'exact nonce'):
            self.consume(nonce='../escape')

class IndependentSourceBootstrapTests(unittest.TestCase):
    def test_exact_human_authorization_precedes_actual_material_reviews_without_future_or_renewed_times(self):
        now = 10000000
        action = {'schemaVersion': 1, 'action': 'attest', 'purpose': ledger.PURPOSE, 'nonce': NONCE,
            'authorized': True, 'attestorNewPurposeAuthorized': True, 'authorizedBy': 'hocheunglai-oss',
            'canonicalHelperSha256': ledger.HELPER_SHA256, 'authorizedAt': now - 1000, 'privateReadinessAt': now - 2000,
            'harnessSha': 'a' * 40, 'scriptSha256': 'b' * 64, 'runId': 99, 'runAttempt': 1,
            'operationId': 'fcos-preview-vercel-attestation-99-' + NONCE,
            'privateActionEvidence': {'path': 'OFFLINE_AUTHORITY'}, 'rootReview': {'path': 'OFFLINE_ROOT'},
            'independentReview': {'path': 'OFFLINE_INDEPENDENT'},
            'authorityBasis': {'kind': 'existing_direct_human_authorization', 'localReviewGrantsAuthority': False,
                'citations': [{'path': 'OFFLINE_CITATION'}]}}
        binding = {k: v for k, v in action.items() if k not in ['privateActionEvidence', 'rootReview', 'independentReview', 'authorityBasis']}
        binding_hash = ledger.digest(ledger.encoded(binding))
        authority = {'kind': 'direct_human_existing_preview_vercel_attestation_authority', 'authorizedBy': action['authorizedBy'],
            'purpose': ledger.PURPOSE, 'authorizedAt': action['authorizedAt'], 'privateReadinessAt': action['privateReadinessAt'],
            'sourceCommit': action['harnessSha'], 'scriptSha256': action['scriptSha256'], 'bindingSha256': binding_hash,
            **{k: True for k in ['existingCapsuleReadAuthorized', 'existingMetadataReaderAuthorized', 'privateKeyAccessAuthorized',
                'actualSigningAuthorized', 'protectedReceiptPublicationAuthorized']},
            **{k: False for k in ['enrollmentAuthorized', 'previewExecutionAuthorized', 'productionAuthorized']}}
        reviews = {role: {'kind': 'existing_preview_vercel_attestation_action_material_review', 'role': role,
            'accepted': True, 'sourceCommit': action['harnessSha'], 'scriptSha256': action['scriptSha256'], 'bindingSha256': binding_hash,
            'reviewerId': '/OFFLINE/' + role, 'reviewedAt': action['authorizedAt'] + offset, 'grantsPrivateAuthority': False}
            for role, offset in [('root', 100), ('independent', 200)]}
        values = {'OFFLINE_AUTHORITY': authority, 'OFFLINE_ROOT': reviews['root'],
            'OFFLINE_INDEPENDENT': reviews['independent'], 'OFFLINE_CITATION': {'OFFLINE': True}}
        with patch.object(ledger, 'pinned', side_effect=lambda ref: values[ref['path']]):
            ledger.assert_action(action, NONCE, now)
            for at in [action['authorizedAt'] - 1, now + 1, action['authorizedAt'] + 600001]:
                reviews['root']['reviewedAt'] = at
                with self.assertRaisesRegex(ValueError, 'material reviews'):
                    ledger.assert_action(action, NONCE, now)
            reviews['root']['reviewedAt'] = action['authorizedAt'] + 100
            with self.assertRaisesRegex(ValueError, 'original exact root action'):
                ledger.assert_action(action, NONCE, action['privateReadinessAt'] + 2700000)

    def test_raw_full_control_closure_rejects_relocated_mutated_missing_or_wrong_mode_validator(self):
        with tempfile.TemporaryDirectory(prefix='fcos-attestation-source-') as directory:
            root = Path(directory).resolve()
            paths = [ledger.ENTRY, 'scripts/lib/preview-vercel-successor-attestation.mjs', 'scripts/lib/preview-vercel-successor-attestation-ledger.py',
                     'scripts/lib/runtime-compatibility-successor-live.mjs', 'scripts/lib/preview-email-build-controls.mjs', 'package-lock.json']
            rows = []
            for relative in paths:
                raw = ('OFFLINE ' + relative).encode()
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)
                rows.append({'path': relative, 'mode': '100644', 'type': 'blob', 'sha': hashlib.sha1(('blob ' + str(len(raw)) + '\0').encode() + raw).hexdigest()})
            action = {'harnessSha': 'a' * 40, 'scriptSha256': ledger.digest((root / ledger.ENTRY).read_bytes())}
            remote = {'user': {'login': 'hocheunglai-oss', 'id': 1},
                'repository': {'full_name': 'hocheunglai-oss/fcos', 'owner': {'login': 'hocheunglai-oss', 'id': 1}, 'default_branch': 'main', 'permissions': {'admin': True}},
                'branch': {'name': 'main', 'protected': True, 'commit': {'sha': 'a' * 40, 'commit': {'tree': {'sha': 'b' * 40}}}},
                'protection': {'enforce_admins': {'enabled': True}, 'required_status_checks': {'strict': True}},
                'tree': {'sha': 'b' * 40, 'truncated': False, 'tree': rows}}
            ledger.assert_remote_source(root, action, remote)
            validator = root / paths[1]
            original = validator.read_bytes()
            validator.write_bytes(b'forged admitted stdout')
            with self.assertRaisesRegex(ValueError, 'differs'):
                ledger.assert_remote_source(root, action, remote)
            validator.write_bytes(original)
            validator.chmod(0o755)
            with self.assertRaisesRegex(ValueError, 'differs'):
                ledger.assert_remote_source(root, action, remote)
            validator.chmod(0o644)
            missing = remote['tree']['tree'].pop()
            with self.assertRaisesRegex(ValueError, 'complete'):
                ledger.assert_remote_source(root, action, remote)
            remote['tree']['tree'].append(missing)
            for target, key, value in [(remote['user'], 'login', 'foreign'), (remote['branch']['commit'], 'sha', 'c' * 40),
                                      (remote['tree'], 'truncated', True), (remote['tree'], 'sha', 'c' * 40)]:
                previous = target[key]
                target[key] = value
                with self.assertRaises(ValueError):
                    ledger.assert_remote_source(root, action, remote)
                target[key] = previous

    def test_invalid_approval_never_reaches_private_evidence_or_authenticated_subprocess(self):
        with patch.object(ledger, 'pinned', side_effect=AssertionError('No evidence read')), patch.object(ledger.subprocess, 'run', side_effect=AssertionError('No provider')):
            for action in [{}, {'authorized': True}, {'action': 'enroll', 'purpose': ledger.PURPOSE}]:
                with self.assertRaises(ValueError):
                    ledger.assert_action(action, NONCE, 10000000)

if __name__ == '__main__':
    unittest.main()
