"""Permanent operation consumption. No provider or signing authority.

The fixed entrypoint requires the reviewed local issuer action admission.
Fixture calls are restricted to OS temporary directories. The exact
unchanged canonical WriteLease owns serialization; this module never resolves it.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import subprocess
import tempfile
import time

BASE = Path('/Users/vincex/Documents/FCOS/.fcos-cli/outputs/overnight-20261004/resumed-indefinite-20261004/schedule-consolidation-20261004/production-reconciliation-coordinator-20261005')
HELPER = BASE / 'public-preview-cancellation-v4/coordinator_guard.py'
HELPER_SHA256 = '2bb8591f79b76b92f917ae7fcc1720d73757b613771812e9e220db015bdd1a18'
WORKFLOW = BASE.parent / 'workflow-state.json'
OWNER = '01a0f08b-7fcb-7870-9edc-343e16052b62'
DOMAIN = b'FCOS-PRODUCTION-CANONICAL-LEASE-V1\0'

def regular(path):
    path = Path(path)
    if any(item.is_symlink() for item in [path, *path.parents]):
        raise ValueError('symlink rejected')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        import stat
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('regular single-link file required')
        return stream.read()

def load_guard(helper):
    raw = regular(helper)
    if hashlib.sha256(raw).hexdigest() != HELPER_SHA256:
        raise ValueError('canonical helper bytes changed')
    # Compile the verified bytes, not an import path that can change after read.
    spec = importlib.util.spec_from_loader('fcos_pinned_canonical_guard', loader=None)
    module = importlib.util.module_from_spec(spec)
    exec(compile(raw, str(helper), 'exec'), module.__dict__)
    return module

def private_json(path):
    raw = regular(path)
    info = Path(path).stat()
    if info.st_uid != os.getuid() or info.st_mode & 0o777 != 0o600 or len(raw) > 65536:
        raise ValueError('private root admission required')
    return json.loads(raw)

def assert_remote_source(root, action, remote):
    """Pure comparison. Actual entry gets remote data from fixed authenticated GitHub GETs."""
    sha = action['binding']['harnessSha']
    user, repository, branch, protection, tree = [remote[k] for k in ['user', 'repository', 'branch', 'protection', 'tree']]
    if (user.get('login') != 'hocheunglai-oss' or not isinstance(user.get('id'), int) or user['id'] < 1
            or repository.get('full_name') != 'hocheunglai-oss/fcos' or repository.get('default_branch') != 'main'
            or repository.get('permissions', {}).get('admin') is not True or branch.get('name') != 'main'
            or branch.get('protected') is not True or branch.get('commit', {}).get('sha') != sha
            or protection.get('enforce_admins', {}).get('enabled') is not True
            or protection.get('required_status_checks', {}).get('strict') is not True
            or tree.get('sha') != branch.get('commit', {}).get('commit', {}).get('tree', {}).get('sha')
            or tree.get('truncated') is not False or not isinstance(tree.get('tree'), list)):
        raise ValueError('actual protected main source required')
    selected = [row for row in tree['tree'] if row.get('type') != 'tree' and
        (row.get('path', '').startswith(('scripts/', 'config/', '.github/', '.codex/'))
         or row.get('path') in ['AGENTS.md', 'package.json', 'package-lock.json'])]
    if len({row['path'] for row in selected}) != len(selected) or not {
            'scripts/lib/release-coordination-ledger.py', 'scripts/release-coordinator-local.mjs', 'package-lock.json'} <= {row['path'] for row in selected}:
        raise ValueError('complete source closure required')
    for row in selected:
        relative = row['path']
        if relative.startswith('/') or any(part in ['', '.', '..'] for part in relative.split('/')) or row.get('mode') not in ['100644', '100755'] or row.get('type') != 'blob':
            raise ValueError('regular protected source required')
        path = root / relative
        raw = regular(path)
        if (hashlib.sha1(('blob ' + str(len(raw)) + '\0').encode() + raw).hexdigest() != row.get('sha')
                or ('100755' if path.stat().st_mode & 0o111 else '100644') != row['mode']):
            raise ValueError('local source differs from actual protected main')
    if hashlib.sha256(regular(root / 'scripts/release-coordinator-local.mjs')).hexdigest() != action.get('scriptSha256'):
        raise ValueError('issuer differs from exact action review')

def authenticated_issuer(nonce):
    # Independent bootstrap: no sibling JavaScript is loaded until its entire
    # control closure matches the actual authenticated protected-main Git tree.
    primary = Path('/Users/vincex/Documents/FCOS')
    directory = primary / '.fcos-cli/release-coordination'
    info = directory.lstat()
    if directory.is_symlink() or info.st_uid != os.getuid() or info.st_mode & 0o777 != 0o700:
        raise ValueError('private admission directory required')
    action = private_json(directory / ('approval-' + nonce + '.json'))
    now = int(time.time() * 1000)
    if (action.get('kind') != 'root_admitted_release_coordination_action' or action.get('action') != 'issue-coordination'
            or action.get('nonce') != nonce or action.get('purpose') != 'FCOS-PRODUCTION-COORDINATION-GRANT-V1\0'
            or action.get('authorizedBy') != 'hocheunglai-oss' or action.get('canonicalHelperSha256') != HELPER_SHA256
            or not isinstance(action.get('authorizedAt'), int) or not 0 <= now - action['authorizedAt'] < 1800000
            or not isinstance(action.get('privateReadinessAt'), int) or not 0 <= now - action['privateReadinessAt'] < 2700000
            or not re.fullmatch(r'[a-f0-9]{40}', action.get('binding', {}).get('harnessSha', ''))):
        raise ValueError('original root action required')
    reviews = []
    for role in ['root', 'independent']:
        reference = action[role + 'Review']
        raw = regular(reference['path'])
        review = private_json(reference['path'])
        if (hashlib.sha256(raw).hexdigest() != reference.get('sha256') or review.get('kind') != 'release_coordination_action_material_review'
                or review.get('role') != role or review.get('accepted') is not True or review.get('sourceCommit') != action['binding']['harnessSha']
                or review.get('scriptSha256') != action.get('scriptSha256')):
            raise ValueError('exact independent source reviews required')
        reviews.append(review)
    if not reviews[0].get('reviewerId') or reviews[0]['reviewerId'] == reviews[1].get('reviewerId'):
        raise ValueError('distinct material reviewers required')
    env = {'PATH': '/usr/bin:/bin', 'HOME': '/Users/vincex', 'GH_HOST': 'github.com',
           'GH_REPO': 'hocheunglai-oss/fcos', 'GH_CONFIG_DIR': str(primary / '.fcos-cli/github')}
    def get(endpoint):
        result = subprocess.run(['/Users/vincex/.local/gh/current/bin/gh', 'api', '--method', 'GET', endpoint],
            env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=True)
        if len(result.stdout) > 16 * 1024 * 1024:
            raise ValueError('bounded source response required')
        return json.loads(result.stdout)
    base = 'repos/hocheunglai-oss/fcos'
    user = get('user')
    if user.get('login') != 'hocheunglai-oss':
        raise ValueError('pinned account required')
    repository = get(base)
    if repository.get('full_name') != 'hocheunglai-oss/fcos' or repository.get('default_branch') != 'main':
        raise ValueError('pinned repository required')
    branch = get(base + '/branches/main')
    tree_sha = branch.get('commit', {}).get('commit', {}).get('tree', {}).get('sha', '')
    if not re.fullmatch(r'[a-f0-9]{40}', tree_sha):
        raise ValueError('actual source tree required')
    root = Path(__file__).resolve().parents[2]
    assert_remote_source(root, action, {'user': user, 'repository': repository, 'branch': branch,
        'protection': get(base + '/branches/main/protection'), 'tree': get(base + '/git/trees/' + tree_sha + '?recursive=1')})
    return root

def claim_and_consume(binding_text, workflow, directory, helper, fixture=False, nonce=None):
    directory, workflow, helper = Path(directory), Path(workflow), Path(helper)
    if fixture:
        temporary = Path(tempfile.gettempdir()).resolve()
        if directory.resolve() == temporary or temporary not in directory.resolve().parents or temporary not in workflow.resolve().parents:
            raise ValueError('fixtures must be temporary')
    elif (directory, workflow, helper) != (BASE, WORKFLOW, HELPER):
        raise ValueError('protected actions not installed')
    actual = None
    if not fixture:
        if not isinstance(nonce, str) or not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', nonce):
            raise ValueError('exact root action admission required')
        root = authenticated_issuer(nonce)
        # No caller binding, transport, path, inherited Node options or approval booleans.
        result = subprocess.run(['/Users/vincex/.local/node-lts/current/bin/node',
            str(root / 'scripts/release-coordinator-local.mjs'), '--validate-ledger-admission', nonce],
            cwd=root, env={'PATH': '/usr/bin:/bin', 'HOME': '/Users/vincex'},
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120, check=True)
        if len(result.stdout) > 65536:
            raise ValueError('admission size')
        admission = json.loads(result.stdout)
        if admission.get('kind') != 'fcos_actual_release_ledger_admission' or admission.get('nonce') != nonce:
            raise ValueError('actual admission required')
        actual = admission['actual']
        binding_text = json.dumps(actual['binding'], separators=(',', ':'), ensure_ascii=False)
    if not isinstance(binding_text, str) or len(binding_text.encode()) > 32768:
        raise ValueError('binding size')
    binding = json.loads(binding_text)
    operation = binding.get('operationId')
    if not isinstance(operation, str) or not re.fullmatch(r'fcos-release-[1-9][0-9]*', operation):
        raise ValueError('exact operation required')
    guard = load_guard(helper)
    coordinator = json.loads(regular(workflow))['unifiedCoordinator']
    current = coordinator.get('writeLeaseHelper', {})
    if (coordinator.get('epoch') != 'production-reconciliation-20261005'
            or coordinator.get('writeLeasePath') != str(directory / 'live-provider-write-lease.json')
            or current.get('path') != str(helper) or current.get('sha256') != HELPER_SHA256
            or current.get('localCoordinationGuardAccepted') is not True
            or current.get('independentReviewPending') is not False or current.get('providerAuthority') is not False):
        raise ValueError('current accepted canonical helper required')
    for key, expected in [('rootAcceptance', 'e498d78f785362f36853be46a925416359c2f06e71422d61feaca89d194150b4'),
                          ('independentRevisionReview', '03c5a3bb8dc7e98896e4493edef9992573cfd8663d38cc3e1001fd71c59372d9')]:
        reference = current.get(key, {})
        if reference.get('sha256') != expected or hashlib.sha256(regular(reference['path'])).hexdigest() != expected:
            raise ValueError('accepted canonical review changed')
    ledger = directory / 'production-coordination-consumption'
    if not ledger.exists():
        os.mkdir(ledger, 0o700)
        fd = os.open(directory, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    if ledger.is_symlink() or not ledger.is_dir() or ledger.stat().st_uid != os.getuid() or ledger.stat().st_mode & 0o077:
        raise ValueError('private permanent ledger required')
    # Identity is ONLY the operation, independent of binding/run/source/expiry.
    path = ledger / (hashlib.sha256(operation.encode()).hexdigest() + '.json')
    if path.exists() or path.is_symlink():
        raise ValueError('operation permanently consumed; GET-only')
    binding_hash = hashlib.sha256(DOMAIN + binding_text.encode()).hexdigest()
    lease = guard.WriteLease(workflow, directory).claim('production', OWNER, operation, binding_hash)
    # Any failure from this point retains the canonical lease. No cleanup,
    # exception, signing result, time or root lease resolution deletes the ledger.
    record = {'schemaVersion': 1, 'kind': 'fcos_production_permanent_coordination_consumption',
              'operationId': operation, 'binding': binding, 'bindingTextSha256': hashlib.sha256(binding_text.encode()).hexdigest(),
              'helperSha256': HELPER_SHA256, 'lease': lease, 'consumedAt': int(time.time() * 1000),
              'possibleSigningOrPublication': True, 'replayForbidden': True, 'providerAuthorityGranted': False}
    guard.create_json(path, record)  # O_EXCL, file fsync and directory fsync.
    raw = guard.read_regular(path)
    return {'lease': lease, 'consumptionSha256': hashlib.sha256(raw).hexdigest(), 'operationId': operation, **({'actual': actual} if actual else {})}

def main():
    # This entrypoint claims coordination only. It cannot sign, publish or write providers.
    if len(sys.argv) != 3 or sys.argv[1] != '--claim-approved':
        raise ValueError('exact root action admission required')
    print(json.dumps(claim_and_consume(None, WORKFLOW, BASE, HELPER, nonce=sys.argv[2]), separators=(',', ':')))

if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Coordination unavailable; retained operation/lease requires root GET-only recovery.', file=sys.stderr)
        sys.exit(1)
