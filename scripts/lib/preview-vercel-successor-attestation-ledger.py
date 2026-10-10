"""Exact existing-credential receipt publication consumption; never signs/publishes.

Independent protected-source bootstrap precedes the native read-only validator.
Only fixed canonical production paths are usable by the executable. Fixture calls
are confined to OS temporary directories and cannot authenticate production.
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

BASE = Path('/Users/vincex/Documents/FCOS/.fcos-cli/outputs/overnight-20261004/resumed-indefinite-20261004/schedule-consolidation-20261004/production-reconciliation-coordinator-20261005')
HELPER = BASE / 'public-preview-cancellation-v4/coordinator_guard.py'
HELPER_SHA256 = '2bb8591f79b76b92f917ae7fcc1720d73757b613771812e9e220db015bdd1a18'
WORKFLOW = BASE.parent / 'workflow-state.json'
OWNER = '01a0f08b-7fcb-7870-9edc-343e16052b62'
PURPOSE = 'existing-preview-vercel-run-authority-exact04ee-v1'
DOMAIN = b'FCOS-EXACT-04EE-ATTESTATION-LEASE-V1\0'
PRIMARY = Path('/Users/vincex/Documents/FCOS')
ENTRY = 'scripts/preview-vercel-successor-attest.mjs'
LEDGER_NAME = 'preview-vercel-successor-attestation-consumption'
UUID = r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}'

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def encoded(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode()

def regular(path, private=False, limit=64 * 1024 * 1024):
    path = Path(path)
    if not path.is_absolute() or any(item.is_symlink() for item in [path, *path.parents]):
        raise ValueError('regular absolute source required')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > limit
                or private and (info.st_uid != os.getuid() or info.st_mode & 0o777 != 0o600)):
            raise ValueError('owned bounded file required')
        return stream.read()

def load_guard(helper):
    raw = regular(helper)
    if digest(raw) != HELPER_SHA256:
        raise ValueError('canonical helper changed')
    module = importlib.util.module_from_spec(importlib.util.spec_from_loader('fcos_exact_attestation_guard', loader=None))
    exec(compile(raw, str(helper), 'exec'), module.__dict__)
    return module

def pinned(ref):
    if (not isinstance(ref, dict) or set(ref) != {'path', 'sha256'}
            or not isinstance(ref['path'], str) or not ref['path'].startswith(str(PRIMARY / '.fcos-cli') + '/')
            or '..' in Path(ref['path']).parts or not re.fullmatch(r'[a-f0-9]{64}', ref.get('sha256', ''))):
        raise ValueError('exact private reference required')
    raw = regular(ref['path'], private=True, limit=65536)
    if digest(raw) != ref['sha256']:
        raise ValueError('private reference changed')
    return json.loads(raw)

def assert_action(action, nonce, now):
    # This independent preliminary check grants no action capability. The native
    # validator applies the full exact schema/source/material/run admission.
    if (action.get('schemaVersion') != 1 or action.get('action') != 'attest' or action.get('purpose') != PURPOSE
            or action.get('nonce') != nonce or action.get('authorized') is not True or action.get('attestorNewPurposeAuthorized') is not True
            or action.get('authorizedBy') != 'hocheunglai-oss' or action.get('canonicalHelperSha256') != HELPER_SHA256
            or not isinstance(action.get('authorizedAt'), int) or not 0 <= now - action['authorizedAt'] <= 3600000
            or not isinstance(action.get('privateReadinessAt'), int) or not 0 <= now - action['privateReadinessAt'] < 2700000
            or action['privateReadinessAt'] > action['authorizedAt'] or not re.fullmatch(r'[a-f0-9]{40}', action.get('harnessSha', ''))
            or not isinstance(action.get('runId'), int) or action['runId'] < 1 or action.get('runAttempt') != 1
            or action.get('operationId') != 'fcos-preview-vercel-attestation-' + str(action['runId']) + '-' + nonce):
        raise ValueError('original exact root action required')
    binding = {k: v for k, v in action.items() if k not in ['privateActionEvidence', 'rootReview', 'independentReview', 'authorityBasis']}
    binding_hash = digest(encoded(binding))
    authority = pinned(action.get('privateActionEvidence'))
    if (authority.get('kind') != 'direct_human_existing_preview_vercel_attestation_authority'
            or authority.get('authorizedBy') != action['authorizedBy'] or authority.get('purpose') != PURPOSE
            or authority.get('authorizedAt') != action['authorizedAt'] or authority.get('privateReadinessAt') != action['privateReadinessAt']
            or authority.get('sourceCommit') != action['harnessSha'] or authority.get('scriptSha256') != action.get('scriptSha256')
            or authority.get('bindingSha256') != binding_hash
            or any(authority.get(k) is not True for k in ['existingCapsuleReadAuthorized', 'existingMetadataReaderAuthorized',
                'privateKeyAccessAuthorized', 'actualSigningAuthorized', 'protectedReceiptPublicationAuthorized'])
            or any(authority.get(k) is not False for k in ['enrollmentAuthorized', 'previewExecutionAuthorized', 'productionAuthorized'])):
        raise ValueError('direct human private action required')
    reviewers = set()
    for role in ['root', 'independent']:
        review = pinned(action.get(role + 'Review'))
        if (review.get('kind') != 'existing_preview_vercel_attestation_action_material_review' or review.get('role') != role
                or review.get('accepted') is not True or review.get('sourceCommit') != action['harnessSha']
                or review.get('scriptSha256') != action.get('scriptSha256') or review.get('bindingSha256') != binding_hash
                or not isinstance(review.get('reviewerId'), str) or not review['reviewerId'] or review['reviewerId'] in reviewers
                or not isinstance(review.get('reviewedAt'), int) or not 0 <= review['reviewedAt'] - action['authorizedAt'] <= 600000
                or not 0 <= now - review['reviewedAt'] <= 1800000 or review.get('grantsPrivateAuthority') is not False):
            raise ValueError('distinct exact material reviews required')
        reviewers.add(review['reviewerId'])
    basis = action.get('authorityBasis', {})
    if (basis.get('kind') != 'existing_direct_human_authorization' or basis.get('localReviewGrantsAuthority') is not False
            or not isinstance(basis.get('citations'), list) or not 0 < len(basis['citations']) <= 10):
        raise ValueError('direct authority references required')
    for citation in basis['citations']:
        pinned(citation)

def assert_remote_source(root, action, remote):
    """Pure byte comparator; production data comes only from fixed pinned GETs."""
    user, repository, branch, protection, tree = [remote[k] for k in ['user', 'repository', 'branch', 'protection', 'tree']]
    if (user.get('login') != 'hocheunglai-oss' or not isinstance(user.get('id'), int) or user['id'] < 1
            or repository.get('full_name') != 'hocheunglai-oss/fcos' or repository.get('owner', {}).get('login') != user['login']
            or repository.get('owner', {}).get('id') != user['id'] or repository.get('default_branch') != 'main'
            or repository.get('permissions', {}).get('admin') is not True or branch.get('name') != 'main'
            or branch.get('protected') is not True or branch.get('commit', {}).get('sha') != action.get('harnessSha')
            or protection.get('enforce_admins', {}).get('enabled') is not True or protection.get('required_status_checks', {}).get('strict') is not True
            or tree.get('sha') != branch.get('commit', {}).get('commit', {}).get('tree', {}).get('sha')
            or tree.get('truncated') is not False or not isinstance(tree.get('tree'), list)):
        raise ValueError('actual protected main source required')
    selected = [row for row in tree['tree'] if row.get('type') != 'tree' and
        (row.get('path', '').startswith(('scripts/', 'config/', '.github/', '.codex/'))
         or row.get('path') in ['AGENTS.md', 'package.json', 'package-lock.json'])]
    required = {ENTRY, 'scripts/lib/preview-vercel-successor-attestation.mjs', 'scripts/lib/preview-vercel-successor-attestation-ledger.py',
                'scripts/lib/runtime-compatibility-successor-live.mjs', 'scripts/lib/preview-email-build-controls.mjs', 'package-lock.json'}
    if len({row['path'] for row in selected}) != len(selected) or not required <= {row['path'] for row in selected}:
        raise ValueError('complete committed source closure required')
    for row in selected:
        relative = row['path']
        if (relative.startswith('/') or any(part in ['', '.', '..'] for part in relative.split('/'))
                or row.get('mode') not in ['100644', '100755'] or row.get('type') != 'blob'):
            raise ValueError('regular raw source required')
        path = root / relative
        raw = regular(path)
        if (hashlib.sha1(('blob ' + str(len(raw)) + '\0').encode() + raw).hexdigest() != row.get('sha')
                or ('100755' if path.stat().st_mode & 0o111 else '100644') != row['mode']):
            raise ValueError('source differs from protected main')
    if digest(regular(root / ENTRY)) != action.get('scriptSha256'):
        raise ValueError('attestor differs from exact action')

def authenticated_issuer(nonce):
    directory = PRIMARY / '.fcos-cli/preview-vercel-successor-attestation'
    info = directory.lstat()
    if (not stat.S_ISDIR(info.st_mode) or directory.is_symlink() or any(p.is_symlink() for p in directory.parents)
            or info.st_uid != os.getuid() or info.st_mode & 0o777 != 0o700):
        raise ValueError('owned action directory required')
    raw = regular(directory / ('approval-' + nonce + '.json'), private=True, limit=65536)
    action = json.loads(raw)
    assert_action(action, nonce, int(time.time() * 1000))
    env = {'PATH': '/usr/bin:/bin', 'HOME': '/Users/vincex', 'GH_HOST': 'github.com',
           'GH_REPO': 'hocheunglai-oss/fcos', 'GH_CONFIG_DIR': str(PRIMARY / '.fcos-cli/github')}
    def get(endpoint):
        result = subprocess.run(['/Users/vincex/.local/gh/current/bin/gh', 'api', '--method', 'GET', endpoint],
            env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=True)
        if len(result.stdout) > 16 * 1024 * 1024:
            raise ValueError('bounded source response required')
        return json.loads(result.stdout)
    base = 'repos/hocheunglai-oss/fcos'
    user = get('user')
    if user.get('login') != 'hocheunglai-oss':
        raise ValueError('pinned isolated account required')
    repository = get(base)
    if repository.get('full_name') != 'hocheunglai-oss/fcos' or repository.get('default_branch') != 'main':
        raise ValueError('pinned repository required')
    branch = get(base + '/branches/main')
    tree_sha = branch.get('commit', {}).get('commit', {}).get('tree', {}).get('sha', '')
    if not re.fullmatch(r'[a-f0-9]{40}', tree_sha):
        raise ValueError('actual raw tree required')
    root = Path(__file__).resolve().parents[2]
    assert_remote_source(root, action, {'user': user, 'repository': repository, 'branch': branch,
        'protection': get(base + '/branches/main/protection'), 'tree': get(base + '/git/trees/' + tree_sha + '?recursive=1')})
    result = subprocess.run(['/Users/vincex/.local/node-lts/current/bin/node', str(root / ENTRY), '--validate-ledger-admission', nonce],
        cwd=root, env={'PATH': '/usr/bin:/bin', 'HOME': '/Users/vincex'},
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120, check=True)
    if len(result.stdout) > 1024 * 1024:
        raise ValueError('bounded actual admission required')
    admission = json.loads(result.stdout)
    if (admission.get('kind') != 'fcos_actual_successor_attestation_ledger_admission' or admission.get('nonce') != nonce
            or admission.get('actual', {}).get('actionSha256') != digest(raw)):
        raise ValueError('original native admission required')
    return action, admission['actual']

def canonical_guard(workflow, directory, helper):
    guard = load_guard(helper)
    coordinator = json.loads(regular(workflow))['unifiedCoordinator']
    current = coordinator.get('writeLeaseHelper', {})
    objective = coordinator.get('objectives', {}).get('production', {})
    if (coordinator.get('status') != 'active' or objective.get('status') != 'active'
            or objective.get('retired') is not False or objective.get('ownerThreadId') != OWNER
            or coordinator.get('epoch') != 'production-reconciliation-20261005'
            or coordinator.get('writeLeasePath') != str(directory / 'live-provider-write-lease.json')
            or current.get('path') != str(helper) or current.get('sha256') != HELPER_SHA256
            or current.get('localCoordinationGuardAccepted') is not True or current.get('independentReviewPending') is not False
            or current.get('providerAuthority') is not False):
        raise ValueError('current accepted canonical helper required')
    for key, expected in [('rootAcceptance', 'e498d78f785362f36853be46a925416359c2f06e71422d61feaca89d194150b4'),
                          ('independentRevisionReview', '03c5a3bb8dc7e98896e4493edef9992573cfd8663d38cc3e1001fd71c59372d9')]:
        ref = current.get(key, {})
        if ref.get('sha256') != expected or digest(regular(ref['path'])) != expected:
            raise ValueError('canonical acceptance changed')
    return guard

def ledger_path(directory, nonce):
    return directory / LEDGER_NAME / (hashlib.sha256(nonce.encode()).hexdigest() + '.json')

def claim_and_consume(actual, workflow, directory, helper, fixture=False, nonce=None):
    directory, workflow, helper = Path(directory), Path(workflow), Path(helper)
    if not isinstance(nonce, str) or not re.fullmatch(UUID, nonce):
        raise ValueError('exact nonce required')
    if fixture:
        temporary = Path(tempfile.gettempdir()).resolve()
        if directory.resolve() == temporary or temporary not in directory.resolve().parents or temporary not in workflow.resolve().parents:
            raise ValueError('fixtures must be temporary')
        operation = actual.get('operationId')
    else:
        if (directory, workflow, helper) != (BASE, WORKFLOW, HELPER) or actual is not None:
            raise ValueError('fixed actual native admission required')
        action, actual = authenticated_issuer(nonce)
        operation = action['operationId']
    if not isinstance(operation, str) or not re.fullmatch(r'fcos-preview-vercel-attestation-[1-9][0-9]*-' + UUID, operation) or not operation.endswith(nonce):
        raise ValueError('fixed exact operation required')
    actual_raw = encoded(actual)
    if len(actual_raw) > 1024 * 1024:
        raise ValueError('bounded admission required')
    guard = canonical_guard(workflow, directory, helper)
    ledger = directory / LEDGER_NAME
    if not ledger.exists():
        try:
            os.mkdir(ledger, 0o700)
            fd = os.open(directory, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        except FileExistsError:
            pass  # Concurrent issuer still must win canonical lease + O_EXCL.
    if (any(p.is_symlink() for p in [ledger, *ledger.parents]) or not ledger.is_dir()
            or ledger.stat().st_uid != os.getuid() or ledger.stat().st_mode & 0o777 != 0o700):
        raise ValueError('private permanent ledger required')
    path = ledger_path(directory, nonce)
    if path.exists() or path.is_symlink():
        raise ValueError('nonce permanently consumed; GET-only')
    lease = guard.WriteLease(workflow, directory).claim('production', OWNER, operation, digest(DOMAIN + actual_raw))
    # Failure after lease claim never releases the lease, retries, deletes or
    # renews the nonce. Unknown delivery remains consumed and GET-only.
    record = {'schemaVersion': 1, 'kind': 'fcos_exact_04ee_permanent_attestation_consumption', 'nonce': nonce,
              'operationId': operation, 'actual': actual, 'helperSha256': HELPER_SHA256, 'lease': lease,
              'consumedAt': int(time.time() * 1000), 'possibleSigningOrPublication': True, 'replayForbidden': True,
              'providerAuthorityGranted': False}
    guard.create_json(path, record)
    raw = regular(path, private=True, limit=2 * 1024 * 1024)
    return {'lease': lease, 'consumptionSha256': digest(raw), 'operationId': operation, 'actual': actual}

def read_consumed(nonce):
    # GET-only canonical reconciliation; cannot claim/release or touch providers.
    if not isinstance(nonce, str) or not re.fullmatch(UUID, nonce):
        raise ValueError('exact nonce required')
    guard = canonical_guard(WORKFLOW, BASE, HELPER)
    raw = regular(ledger_path(BASE, nonce), private=True, limit=2 * 1024 * 1024)
    record = json.loads(raw)
    lease = json.loads(guard.read_regular(BASE / 'live-provider-write-lease.json'))
    if (record.get('kind') != 'fcos_exact_04ee_permanent_attestation_consumption' or record.get('nonce') != nonce
            or record.get('helperSha256') != HELPER_SHA256 or record.get('replayForbidden') is not True
            or record.get('providerAuthorityGranted') is not False or record.get('lease') != lease):
        raise ValueError('original consumed intent and retained lease required')
    return {'lease': lease, 'consumptionSha256': digest(raw), 'operationId': record['operationId'], 'actual': record['actual']}

def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ['--claim-approved', '--read-consumed']:
        raise ValueError('fixed native action required')
    result = (claim_and_consume(None, WORKFLOW, BASE, HELPER, nonce=sys.argv[2])
              if sys.argv[1] == '--claim-approved' else read_consumed(sys.argv[2]))
    print(json.dumps(result, separators=(',', ':'), ensure_ascii=False))

if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Existing attestation unavailable; retain original nonce/lease for GET-only recovery.', file=sys.stderr)
        sys.exit(1)
