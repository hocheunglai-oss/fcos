"""Fixed bootstrap and permanent absent-enrollment consumption; no credentials.

The production entry authenticates raw reviewed draft source before loading its
Node validator. The unchanged canonical WriteLease never grants provider power.
Fixture calls are confined to OS temporary directories.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time

PRIMARY = Path('/Users/vincex/Documents/FCOS')
BASE = PRIMARY / '.fcos-cli/outputs/overnight-20261004/resumed-indefinite-20261004/schedule-consolidation-20261004/production-reconciliation-coordinator-20261005'
WORKFLOW = BASE.parent / 'workflow-state.json'
HELPER = BASE / 'public-preview-cancellation-v4/coordinator_guard.py'
HELPER_SHA256 = '2bb8591f79b76b92f917ae7fcc1720d73757b613771812e9e220db015bdd1a18'
OWNER = '01a0f08b-7fcb-7870-9edc-343e16052b62'
PURPOSE = 'FCOS-EXACT-04EE-ABSENT-ENROLLMENT-RECOVERY-V1'
DOMAIN = b'FCOS-ABSENT-PREVIEW-ENROLLMENT-LEASE-V1\0'
CLI = 'scripts/preview-vercel-enrollment-recovery.mjs'
LIBRARY = 'scripts/lib/preview-vercel-enrollment-recovery.mjs'
LEDGER = 'scripts/lib/preview-vercel-enrollment-recovery-ledger.py'
BINDING_KEYS = ['schemaVersion', 'kind', 'action', 'purpose', 'authorizedBy', 'nonce', 'operationId', 'enrollmentId',
    'target', 'candidateSha', 'sourceDigest', 'lockHash', 'sourceCommit', 'sourceTree', 'protectedMainSha', 'sourcePullRequest', 'sourceBranch',
    'scriptSha256', 'librarySha256', 'ledgerSha256', 'canonicalHelperSha256',
    'authorizedAt', 'privateReadinessAt', 'expiresAt', 'leaseDeadline', 'secretMetadata']

def regular(path):
    path = Path(path)
    if not path.is_absolute() or any(item.is_symlink() for item in [path, *path.parents]):
        raise ValueError('absolute regular path required')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('single-link regular file required')
        return stream.read()

def private_json(path):
    raw = regular(path)
    info = Path(path).stat()
    if info.st_uid != os.getuid() or info.st_mode & 0o777 != 0o600 or len(raw) > 65536:
        raise ValueError('private action file required')
    return json.loads(raw)

def load_guard(helper):
    raw = regular(helper)
    if hashlib.sha256(raw).hexdigest() != HELPER_SHA256:
        raise ValueError('canonical helper changed')
    spec = importlib.util.spec_from_loader('fcos_enrollment_canonical_guard', loader=None)
    module = importlib.util.module_from_spec(spec)
    exec(compile(raw, str(helper), 'exec'), module.__dict__)
    return module

def assert_raw_source(root, action, remote):
    """Pure byte comparison. Production supplies fixed authenticated GETs."""
    user, repository, branch, protection, pr, commit, tree = [remote[k] for k in
        ['user', 'repository', 'branch', 'protection', 'pr', 'commit', 'tree']]
    if (user.get('login') != 'hocheunglai-oss' or not isinstance(user.get('id'), int) or user['id'] < 1
            or repository.get('full_name') != 'hocheunglai-oss/fcos' or repository.get('default_branch') != 'main'
            or repository.get('owner', {}).get('id') != user['id'] or repository.get('permissions', {}).get('admin') is not True
            or branch.get('name') != 'main' or branch.get('protected') is not True
            or branch.get('commit', {}).get('sha') != action.get('protectedMainSha')
            or protection.get('enforce_admins', {}).get('enabled') is not True
            or protection.get('required_status_checks', {}).get('strict') is not True
            or pr.get('number') != action.get('sourcePullRequest') or pr.get('draft') is not True or pr.get('state') != 'open'
            or pr.get('user', {}).get('login') != user['login']
            or pr.get('head', {}).get('repo', {}).get('full_name') != repository['full_name']
            or pr.get('base', {}).get('repo', {}).get('full_name') != repository['full_name']
            or pr.get('head', {}).get('sha') != action.get('sourceCommit') or pr.get('head', {}).get('ref') != action.get('sourceBranch')
            or pr.get('base', {}).get('ref') != 'main' or pr.get('base', {}).get('sha') != action.get('protectedMainSha')
            or commit.get('sha') != action.get('sourceCommit') or commit.get('tree', {}).get('sha') != action.get('sourceTree')
            or tree.get('sha') != action.get('sourceTree') or tree.get('truncated') is not False or not isinstance(tree.get('tree'), list)):
        raise ValueError('actual reviewed draft and protected baseline required')
    rows = [row for row in tree['tree'] if row.get('type') != 'tree' and
        (row.get('path', '').startswith(('scripts/', 'config/', '.github/', '.codex/'))
         or row.get('path') in ['AGENTS.md', 'package.json', 'package-lock.json', 'vercel.json'])]
    if len({row['path'] for row in rows}) != len(rows) or not {CLI, LIBRARY, LEDGER, 'vercel.json'} <= {row['path'] for row in rows}:
        raise ValueError('complete raw source required')
    for row in rows:
        relative = row['path']
        if relative.startswith('/') or any(part in ['', '.', '..'] for part in relative.split('/')) or row.get('type') != 'blob' or row.get('mode') not in ['100644', '100755']:
            raise ValueError('regular raw source required')
        path = root / relative
        raw = regular(path)
        if (hashlib.sha1(('blob ' + str(len(raw)) + '\0').encode() + raw).hexdigest() != row.get('sha')
                or ('100755' if path.stat().st_mode & 0o111 else '100644') != row['mode']):
            raise ValueError('source differs from reviewed draft')
    for key, path in [('scriptSha256', CLI), ('librarySha256', LIBRARY), ('ledgerSha256', LEDGER)]:
        if hashlib.sha256(regular(root / path)).hexdigest() != action.get(key):
            raise ValueError('reviewed helper hash required')

def authenticated_admission(nonce):
    directory = PRIMARY / '.fcos-cli/preview-vercel-enrollment-recovery'
    info = directory.lstat()
    if directory.is_symlink() or not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o777 != 0o700:
        raise ValueError('private admission directory required')
    action = private_json(directory / ('approval-' + nonce + '.json'))
    now = int(time.time() * 1000)
    if (action.get('kind') != 'root_admitted_absent_preview_enrollment_recovery' or action.get('action') != 'enroll-absent'
            or action.get('purpose') != PURPOSE or action.get('nonce') != nonce or action.get('authorizedBy') != 'hocheunglai-oss'
            or action.get('canonicalHelperSha256') != HELPER_SHA256
            or not isinstance(action.get('authorizedAt'), int) or not 0 <= now - action['authorizedAt'] <= 3600000
            or not isinstance(action.get('privateReadinessAt'), int) or not 0 <= now - action['privateReadinessAt'] < 2700000
            or not isinstance(action.get('sourcePullRequest'), int) or action['sourcePullRequest'] < 1
            or not re.fullmatch(r'[a-f0-9]{40}', action.get('sourceCommit', ''))
            or not re.fullmatch(r'[a-f0-9]{40}', action.get('sourceTree', ''))
            or not re.fullmatch(r'codex/[a-z0-9][a-z0-9/_-]{1,180}', action.get('sourceBranch', ''))):
        raise ValueError('fresh exact recovery action required')
    pinned = {}
    for key in ['privateActionEvidence', 'rootReview', 'independentReview']:
        reference = action[key]
        if hashlib.sha256(regular(reference['path'])).hexdigest() != reference.get('sha256'):
            raise ValueError('private action or review changed')
        pinned[key] = private_json(reference['path'])
    binding_hash = hashlib.sha256(json.dumps({key: action[key] for key in BINDING_KEYS}, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    evidence = pinned['privateActionEvidence']
    if (evidence.get('kind') != 'direct_human_absent_preview_enrollment_recovery_authority'
            or evidence.get('authorizedBy') != action['authorizedBy'] or evidence.get('purpose') != PURPOSE
            or evidence.get('sourceCommit') != action['sourceCommit'] or evidence.get('scriptSha256') != action['scriptSha256']
            or evidence.get('bindingSha256') != binding_hash or evidence.get('authorizedAt') != action['authorizedAt']
            or evidence.get('privateReadinessAt') != action['privateReadinessAt']
            or any(evidence.get(key) is not True for key in ['localManagementCredentialReadAuthorized', 'oneProjectTokenIssuanceAuthorized',
                'newCapsuleWriteAuthorized', 'pairedProtectedSecretCreationAuthorized', 'disabledEnrollmentPinWriteAuthorized', 'reviewedDraftSourceAuthorized'])
            or any(evidence.get(key) is not False for key in ['attestationKeyAccessAuthorized', 'signingAuthorized',
                'previewExecutionAuthorized', 'productionAuthorized', 'financialAuthorized'])):
        raise ValueError('direct human action required before authenticated reads')
    reviewers = set()
    for role in ['root', 'independent']:
        review = pinned[role + 'Review']
        if (review.get('kind') != 'absent_preview_enrollment_recovery_material_review' or review.get('role') != role
                or review.get('accepted') is not True or review.get('sourceCommit') != action['sourceCommit']
                or review.get('scriptSha256') != action['scriptSha256'] or review.get('bindingSha256') != binding_hash
                or not review.get('reviewerId') or review['reviewerId'] in reviewers
                or not isinstance(review.get('reviewedAt'), int) or not 0 <= review['reviewedAt'] - action['authorizedAt'] < 600000
                or review['reviewedAt'] > now):
            raise ValueError('distinct exact reviews required before authenticated reads')
        reviewers.add(review['reviewerId'])
    # No caller provider/transport/clock can enter the bootstrap.
    env = {'PATH': '/usr/bin:/bin', 'HOME': '/Users/vincex', 'GH_HOST': 'github.com',
           'GH_REPO': 'hocheunglai-oss/fcos', 'GH_CONFIG_DIR': str(PRIMARY / '.fcos-cli/github')}
    def get(endpoint):
        result = subprocess.run(['/Users/vincex/.local/gh/current/bin/gh', 'api', '--method', 'GET', endpoint],
            env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=True)
        if len(result.stdout) > 16 * 1024 * 1024:
            raise ValueError('bounded response required')
        return json.loads(result.stdout)
    base = 'repos/hocheunglai-oss/fcos'
    user = get('user')
    if user.get('login') != 'hocheunglai-oss':
        raise ValueError('pinned account required')
    root = Path(__file__).resolve().parents[2]
    remote = {'user': user, 'repository': get(base), 'branch': get(base + '/branches/main'),
        'protection': get(base + '/branches/main/protection'), 'pr': get(base + '/pulls/' + str(action['sourcePullRequest'])),
        'commit': get(base + '/git/commits/' + action['sourceCommit']),
        'tree': get(base + '/git/trees/' + action['sourceTree'] + '?recursive=1')}
    assert_raw_source(root, action, remote)
    result = subprocess.run(['/Users/vincex/.local/node-lts/current/bin/node', str(root / CLI), '--validate-ledger-admission', nonce],
        cwd=root, env={'PATH': '/usr/bin:/bin', 'HOME': '/Users/vincex'}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120, check=True)
    if len(result.stdout) > 65536:
        raise ValueError('bounded admission required')
    admission = json.loads(result.stdout)
    if admission.get('kind') != 'fcos_actual_absent_enrollment_recovery_admission' or admission.get('nonce') != nonce:
        raise ValueError('actual read-only admission required')
    return admission['actual']

def canonical_guard(workflow, directory, helper):
    guard = load_guard(helper)
    coordinator = json.loads(regular(workflow))['unifiedCoordinator']
    current = coordinator.get('writeLeaseHelper', {})
    production = coordinator.get('objectives', {}).get('production', {})
    if (coordinator.get('status') != 'active' or production.get('status') != 'active'
            or production.get('retired') is not False or production.get('ownerThreadId') != OWNER
            or coordinator.get('epoch') != 'production-reconciliation-20261005'
            or coordinator.get('writeLeasePath') != str(directory / 'live-provider-write-lease.json')
            or current.get('path') != str(helper) or current.get('sha256') != HELPER_SHA256
            or current.get('localCoordinationGuardAccepted') is not True
            or current.get('independentReviewPending') is not False or current.get('providerAuthority') is not False):
        raise ValueError('current accepted canonical helper required')
    for key, expected in [('rootAcceptance', 'e498d78f785362f36853be46a925416359c2f06e71422d61feaca89d194150b4'),
                          ('independentRevisionReview', '03c5a3bb8dc7e98896e4493edef9992573cfd8663d38cc3e1001fd71c59372d9')]:
        reference = current.get(key, {})
        if reference.get('sha256') != expected or hashlib.sha256(regular(reference['path'])).hexdigest() != expected:
            raise ValueError('accepted canonical reviews changed')
    return guard

def claim_and_consume(binding_text, workflow, directory, helper, fixture=False, nonce=None):
    workflow, directory, helper = Path(workflow), Path(directory), Path(helper)
    if fixture:
        temporary = Path(tempfile.gettempdir()).resolve()
        if temporary not in directory.resolve().parents or temporary not in workflow.resolve().parents:
            raise ValueError('fixtures confined to temporary directories')
    elif (workflow, directory, helper) != (WORKFLOW, BASE, HELPER):
        raise ValueError('fixed production paths required')
    actual = None
    if not fixture:
        if not isinstance(nonce, str) or not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', nonce):
            raise ValueError('exact action nonce required')
        actual = authenticated_admission(nonce)
        binding_text = json.dumps(actual['binding'], separators=(',', ':'), ensure_ascii=False)
    if not isinstance(binding_text, str) or len(binding_text.encode()) > 65536:
        raise ValueError('bounded binding required')
    binding = json.loads(binding_text)
    operation = binding.get('operationId')
    action_nonce = binding.get('nonce')
    if not isinstance(action_nonce, str) or not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', action_nonce):
        raise ValueError('exact permanent action nonce required')
    if not isinstance(operation, str) or not re.fullmatch(r'fcos-preview-enrollment-recovery-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', operation):
        raise ValueError('exact enrollment operation required')
    guard = canonical_guard(workflow, directory, helper)
    ledger = directory / 'preview-enrollment-recovery-consumption'
    if not ledger.exists():
        os.mkdir(ledger, 0o700)
        fd = os.open(directory, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    info = ledger.lstat()
    if ledger.is_symlink() or not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o777 != 0o700:
        raise ValueError('private permanent ledger required')
    path = ledger / (hashlib.sha256(operation.encode()).hexdigest() + '.json')
    nonce_path = ledger / ('nonce-' + hashlib.sha256(action_nonce.encode()).hexdigest() + '.json')
    if any(item.exists() or item.is_symlink() for item in [path, nonce_path]):
        raise ValueError('operation or nonce permanently consumed; GET-only')
    lease = guard.WriteLease(workflow, directory).claim('production', OWNER, operation, hashlib.sha256(DOMAIN + binding_text.encode()).hexdigest())
    record = {'schemaVersion': 1, 'kind': 'fcos_absent_preview_enrollment_recovery_permanent_consumption',
        'operationId': operation, 'nonce': action_nonce, 'binding': binding, 'helperSha256': HELPER_SHA256, 'lease': lease,
        'consumedAt': int(time.time() * 1000), 'possibleIssuanceOrPrivateWrite': True, 'replayForbidden': True,
        'providerAuthorityGranted': False}
    guard.create_json(nonce_path, record)  # O_EXCL plus file and directory fsync.
    guard.create_json(path, record)  # Neither permanent record is deleted on failure.
    return {'operationId': operation, 'lease': lease, 'consumptionSha256': hashlib.sha256(regular(path)).hexdigest()}

def read_consumed(nonce, workflow=WORKFLOW, directory=BASE, helper=HELPER, fixture=False):
    # Fixed executable is GET-only. Fixture paths remain OS-temporary only.
    workflow, directory, helper = Path(workflow), Path(directory), Path(helper)
    if fixture:
        temporary = Path(tempfile.gettempdir()).resolve()
        if temporary not in directory.resolve().parents or temporary not in workflow.resolve().parents:
            raise ValueError('fixtures confined to temporary directories')
    elif (workflow, directory, helper) != (WORKFLOW, BASE, HELPER):
        raise ValueError('fixed production paths required')
    if not isinstance(nonce, str) or not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', nonce):
        raise ValueError('exact consumed nonce required')
    guard = canonical_guard(workflow, directory, helper)
    ledger = directory / 'preview-enrollment-recovery-consumption'
    nonce_path = ledger / ('nonce-' + hashlib.sha256(nonce.encode()).hexdigest() + '.json')
    record = private_json(nonce_path)
    operation = record.get('operationId')
    if not isinstance(operation, str) or not re.fullmatch(r'fcos-preview-enrollment-recovery-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', operation):
        raise ValueError('fixed original operation required')
    operation_path = ledger / (hashlib.sha256(operation.encode()).hexdigest() + '.json')
    operation_record = private_json(operation_path)
    raw = regular(operation_path)
    lease = json.loads(guard.read_regular(directory / 'live-provider-write-lease.json'))
    if (operation_record != record or json.loads(raw) != record or record.get('kind') != 'fcos_absent_preview_enrollment_recovery_permanent_consumption'
            or record.get('nonce') != nonce or record.get('binding', {}).get('nonce') != nonce
            or record.get('binding', {}).get('operationId') != operation or record.get('helperSha256') != HELPER_SHA256
            or record.get('replayForbidden') is not True or record.get('providerAuthorityGranted') is not False
            or record.get('lease') != lease
            or lease.get('bindingSha256') != hashlib.sha256(DOMAIN + json.dumps(record['binding'], separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()):
        raise ValueError('original permanent intent and retained canonical lease required')
    return {'operationId': operation, 'lease': lease, 'consumptionSha256': hashlib.sha256(raw).hexdigest()}

if __name__ == '__main__':
    try:
        if len(sys.argv) != 3 or sys.argv[1] not in ['--claim-approved', '--read-consumed']:
            raise ValueError('exact approved native action required')
        result = (claim_and_consume(None, WORKFLOW, BASE, HELPER, nonce=sys.argv[2])
                  if sys.argv[1] == '--claim-approved' else read_consumed(sys.argv[2]))
        print(json.dumps(result, separators=(',', ':')))
    except Exception:
        print('Enrollment recovery consumption refused; retain lease and original intent for GET-only reconciliation.', file=sys.stderr)
        sys.exit(1)
