import concurrent.futures
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('ledger', ROOT / 'scripts/lib/release-coordination-ledger.py')
ledger = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ledger)

class PermanentConsumptionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='fcos-coordination-ledger-')
        self.directory = Path(self.temp.name).resolve()
        self.workflow = self.directory / 'workflow-state.json'
        fixtures = ROOT / 'tests/fixtures/preview-attestor-current-guard-24758'
        self.helper = fixtures / 'coordinator_guard.py'
        self.guard = ledger.load_guard(self.helper)
        # Keep the real helper and review hash checks, with public offline bytes.
        # Every workflow, lease and consumption write stays in the temp directory.
        helper = {'path': str(self.helper), 'sha256': ledger.HELPER_SHA256,
            'localCoordinationGuardAccepted': True, 'independentReviewPending': False,
            'providerAuthority': False,
            'rootAcceptance': {'path': str(fixtures / 'root-acceptance.json'),
                'sha256': 'e490439a30f58e3bc3207ff48d7419d8424255f27c05e56304062e4783816093'},
            'independentRevisionReview': {'path': str(fixtures / 'independent-review.json'),
                'sha256': 'f0c8fc487abdf35320b2960871f1f8eeae9c2680acaaeac71bccb52909b1c56b'},
            'independentFinalScopeAddendum': {'path': str(fixtures / 'independent-final-scope-addendum.json'),
                'sha256': 'd84442d57dea9bd42c309f5551441ced29b68132c644cf80dcee32dd500bc832'}}
        self.state = {'unifiedCoordinator': {'status': 'active', 'epoch': 'production-reconciliation-20261005',
            'writeLeasePath': str(self.directory / 'live-provider-write-lease.json'), 'writeLeaseHelper': helper,
            'objectives': {'production': {'ownerThreadId': ledger.OWNER, 'retired': False, 'status': 'active'}}}}
        self.save()
        self.binding = {'operationId': 'fcos-release-99', 'runId': 99, 'version': 'fixture-original'}

    def tearDown(self):
        self.temp.cleanup()

    def save(self):
        self.workflow.write_text(json.dumps(self.state))

    def consume(self, binding=None):
        return ledger.claim_and_consume(json.dumps(binding or self.binding, separators=(',', ':')),
            self.workflow, self.directory, self.helper, fixture=True)

    def test_permanent_exclusive_record_and_canonical_lease_are_fsynced_before_return(self):
        import os
        with patch.object(os, 'fsync', wraps=os.fsync) as sync:
            result = self.consume()
        self.assertGreaterEqual(sync.call_count, 5)
        path = self.directory / 'production-coordination-consumption' / (hashlib.sha256(self.binding['operationId'].encode()).hexdigest() + '.json')
        raw = path.read_bytes()
        self.assertEqual(result['consumptionSha256'], hashlib.sha256(raw).hexdigest())
        record = json.loads(raw)
        self.assertEqual(record['binding'], self.binding)
        self.assertEqual(record['helperSha256'], '24758c4191afae79fa4b149a166c450ac1cac20951a5f648f3cc3853969aa31d')
        self.assertEqual(record['lease'], json.loads((self.directory / 'live-provider-write-lease.json').read_bytes()))
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertTrue(record['replayForbidden'])
        self.assertFalse(record['providerAuthorityGranted'])
        with self.assertRaises(ValueError):
            self.consume()

    def test_same_operation_changed_binding_is_rejected_after_actual_temp_root_resolution(self):
        first = self.consume()
        lease = first['lease']
        proof = {'kind': 'reviewed_coordinator_write_resolution_v1', **{key: lease[key] for key in
            ['epoch', 'ownerThreadId', 'operationId', 'bindingSha256', 'leaseId']},
            'outcome': 'verified_no_provider_submission', 'releaseOwnerMaterialAcceptance': 'TEMP ROOT REVIEW FIXTURE',
            'actualActionReadbackProofs': ['TEMP NO SUBMISSION FIXTURE']}
        path = self.directory / 'root-resolution.json'
        self.guard.create_json(path, proof)
        self.guard.WriteLease(self.workflow, self.directory).resolve(lease, path, hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertFalse((self.directory / 'live-provider-write-lease.json').exists())
        changed = {**self.binding, 'runId': 100, 'version': 'new-source-or-grant', 'expiresAt': 9999999999999}
        with self.assertRaisesRegex(ValueError, 'permanently consumed'):
            self.consume(changed)
        self.assertFalse((self.directory / 'live-provider-write-lease.json').exists())
        self.assertEqual(len(list((self.directory / 'production-coordination-consumption').glob('*.json'))), 1)
        self.assertTrue((self.directory / ('write-lease-resolution-' + lease['leaseId'] + '.json')).exists())

    def assert_refuses_before_claim(self):
        load_guard = ledger.load_guard
        claims = []
        def tracked_guard(helper):
            guard = load_guard(helper)
            claim = guard.WriteLease.claim
            def tracked_claim(instance, *args, **kwargs):
                claims.append(args)
                return claim(instance, *args, **kwargs)
            guard.WriteLease.claim = tracked_claim
            return guard
        with patch.object(ledger, 'load_guard', side_effect=tracked_guard):
            with self.assertRaises((ValueError, FileNotFoundError)):
                self.consume()
        self.assertEqual(claims, [])
        self.assertFalse((self.directory / 'live-provider-write-lease.json').exists())
        self.assertFalse((self.directory / 'production-coordination-consumption').exists())

    def test_all_three_exact_current_reviews_are_required_before_claim(self):
        current = self.state['unifiedCoordinator']['writeLeaseHelper']
        for key in ['rootAcceptance', 'independentRevisionReview', 'independentFinalScopeAddendum']:
            original = current[key]
            for changed in [None, {**original, 'sha256': '0' * 64},
                            {**original, 'path': str(self.directory / 'missing-review.json')}]:
                with self.subTest(review=key, changed=changed):
                    if changed is None:
                        del current[key]
                    else:
                        current[key] = changed
                    self.save()
                    self.assert_refuses_before_claim()
                    current[key] = original
        self.save()

    def test_retired_or_missing_helper_cannot_fall_back_before_claim(self):
        original = self.helper
        current = self.state['unifiedCoordinator']['writeLeaseHelper']
        for helper in [ROOT / 'tests/fixtures/preview-email-coordination-ledger/coordinator_guard.py',
                       self.directory / 'missing-helper.py']:
            with self.subTest(helper=str(helper)):
                self.helper = helper
                current['path'] = str(helper)
                self.save()
                self.assert_refuses_before_claim()
        self.helper = original
        current['path'] = str(original)
        self.save()

    def test_consumption_failure_after_successful_claim_retains_lease(self):
        original = self.guard.create_json
        def fail_consumption(path, value):
            if Path(path).parent.name == 'production-coordination-consumption':
                raise OSError('TEMP simulated fsync/write uncertainty')
            return original(path, value)
        with patch.object(ledger, 'load_guard', return_value=self.guard), patch.object(self.guard, 'create_json', side_effect=fail_consumption):
            with self.assertRaises(OSError):
                self.consume()
        self.assertTrue((self.directory / 'live-provider-write-lease.json').exists())
        with self.assertRaises(FileExistsError):
            self.consume()

    def test_signing_crash_or_expiry_does_not_release_or_reissue(self):
        first = self.consume()
        changed = {**self.binding, 'expiresAt': 1}
        with self.assertRaises(ValueError):
            self.consume(changed)
        self.assertEqual(json.loads((self.directory / 'live-provider-write-lease.json').read_bytes()), first['lease'])

    def test_concurrent_temporary_issuers_cannot_consume_twice(self):
        def attempt():
            try:
                return self.consume()
            except (ValueError, FileExistsError):
                return None
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: attempt(), range(2)))
        self.assertEqual(sum(result is not None for result in results), 1)
        self.assertEqual(len(list((self.directory / 'production-coordination-consumption').glob('*.json'))), 1)

    def test_retired_or_foreign_current_helper_epoch_and_approval_fail_before_claim(self):
        for key, value in [('epoch', 'retired-epoch'), ('writeLeasePath', 'foreign')]:
            before = self.state['unifiedCoordinator'][key]
            self.state['unifiedCoordinator'][key] = value
            self.save()
            with self.assertRaises(ValueError):
                self.consume()
            self.assertFalse((self.directory / 'live-provider-write-lease.json').exists())
            self.state['unifiedCoordinator'][key] = before
        helper = self.state['unifiedCoordinator']['writeLeaseHelper']
        for key, value in [('path', 'foreign'), ('sha256', '0' * 64), ('localCoordinationGuardAccepted', False),
                           ('independentReviewPending', True), ('providerAuthority', True)]:
            before = helper[key]
            helper[key] = value
            self.save()
            with self.assertRaises((ValueError, FileNotFoundError)):
                self.consume()
            self.assertFalse((self.directory / 'live-provider-write-lease.json').exists())
            helper[key] = before

    def test_tampered_offline_helper_and_reviews_fail_before_claim(self):
        original_helper = self.helper
        helper_metadata = self.state['unifiedCoordinator']['writeLeaseHelper']
        cases = [('helper', original_helper),
            ('rootAcceptance', Path(helper_metadata['rootAcceptance']['path'])),
            ('independentRevisionReview', Path(helper_metadata['independentRevisionReview']['path'])),
            ('independentFinalScopeAddendum', Path(helper_metadata['independentFinalScopeAddendum']['path']))]
        for key, source in cases:
            with self.subTest(fixture=key):
                changed = self.directory / (key + '.fixture')
                changed.write_bytes(source.read_bytes() + b'\n')
                if key == 'helper':
                    self.helper = changed
                    helper_metadata['path'] = str(changed)
                else:
                    helper_metadata[key]['path'] = str(changed)
                self.save()
                with self.assertRaisesRegex(ValueError, 'changed'):
                    self.consume()
                self.assertFalse((self.directory / 'live-provider-write-lease.json').exists())
                self.assertFalse((self.directory / 'production-coordination-consumption').exists())
                self.helper = original_helper
                helper_metadata['path'] = str(original_helper)
                if key != 'helper':
                    helper_metadata[key]['path'] = str(source)
                self.save()

    def test_fixture_entry_cannot_target_actual_canonical_directory(self):
        with self.assertRaisesRegex(ValueError, 'temporary'):
            ledger.claim_and_consume(json.dumps(self.binding), ledger.WORKFLOW, ledger.BASE, ledger.HELPER, fixture=True)
        with self.assertRaisesRegex(ValueError, 'not installed'):
            ledger.claim_and_consume(json.dumps(self.binding), self.workflow, self.directory, self.helper)

class BootstrapSourceTests(unittest.TestCase):
    def test_relocated_or_replaced_validator_cannot_substitute_for_actual_protected_source(self):
        with tempfile.TemporaryDirectory(prefix='fcos-bootstrap-source-') as directory:
            root = Path(directory).resolve()
            rows = []
            for relative, raw in [('scripts/lib/release-coordination-ledger.py', b'unchanged ledger'),
                                  ('scripts/release-coordinator-local.mjs', b'reviewed real validator'), ('package-lock.json', b'locked')]:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)
                rows.append({'path': relative, 'mode': '100644', 'type': 'blob',
                    'sha': hashlib.sha1(('blob ' + str(len(raw)) + '\0').encode() + raw).hexdigest()})
            sha, tree = 'a' * 40, 'b' * 40
            action = {'binding': {'harnessSha': sha}, 'scriptSha256': hashlib.sha256(b'reviewed real validator').hexdigest()}
            remote = {'user': {'login': 'hocheunglai-oss', 'id': 1},
                'repository': {'full_name': 'hocheunglai-oss/fcos', 'default_branch': 'main', 'permissions': {'admin': True}},
                'branch': {'name': 'main', 'protected': True, 'commit': {'sha': sha, 'commit': {'tree': {'sha': tree}}}},
                'protection': {'enforce_admins': {'enabled': True}, 'required_status_checks': {'strict': True}},
                'tree': {'sha': tree, 'truncated': False, 'tree': rows}}
            ledger.assert_remote_source(root, action, remote)
            (root / 'scripts/release-coordinator-local.mjs').write_text('fabricated admitted stdout')
            with self.assertRaisesRegex(ValueError, 'differs'):
                ledger.assert_remote_source(root, action, remote)
            (root / 'scripts/release-coordinator-local.mjs').write_bytes(b'reviewed real validator')
            for target, key, value in [(remote['user'], 'login', 'foreign'), (remote['branch']['commit'], 'sha', 'c' * 40),
                                       (remote['tree'], 'truncated', True), (remote['tree'], 'sha', 'c' * 40)]:
                old = target[key]; target[key] = value
                with self.assertRaises(ValueError): ledger.assert_remote_source(root, action, remote)
                target[key] = old

if __name__ == '__main__':
    unittest.main()
