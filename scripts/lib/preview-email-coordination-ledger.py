"""Permanent operation consumption. No provider or signing authority.

Production invocation is deliberately disabled under implementation-only human
authority. Fixture calls are restricted to OS temporary directories. The exact
unchanged canonical WriteLease owns serialization; this module never resolves it.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time

PROTECTED_ACTIONS_INSTALLED = False
BASE = Path('/Users/vincex/Documents/FCOS/.fcos-cli/outputs/overnight-20261004/resumed-indefinite-20261004/schedule-consolidation-20261004/production-reconciliation-coordinator-20261005')
HELPER = BASE / 'public-preview-cancellation-v4/coordinator_guard.py'
HELPER_SHA256 = '2bb8591f79b76b92f917ae7fcc1720d73757b613771812e9e220db015bdd1a18'
WORKFLOW = BASE.parent / 'workflow-state.json'
OWNER = '01a0f08b-7fcb-7870-9edc-343e16052b62'
DOMAIN = b'FCOS-EXACT-04EE-CANONICAL-LEASE-V1\0'

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

def claim_and_consume(binding_text, workflow, directory, helper, fixture=False):
    directory, workflow, helper = Path(directory), Path(workflow), Path(helper)
    if fixture:
        temporary = Path(tempfile.gettempdir()).resolve()
        if directory.resolve() == temporary or temporary not in directory.resolve().parents or temporary not in workflow.resolve().parents:
            raise ValueError('fixtures must be temporary')
    elif not PROTECTED_ACTIONS_INSTALLED or (directory, workflow, helper) != (BASE, WORKFLOW, HELPER):
        raise ValueError('protected actions not installed')
    if not isinstance(binding_text, str) or len(binding_text.encode()) > 32768:
        raise ValueError('binding size')
    binding = json.loads(binding_text)
    operation = binding.get('operationId')
    if not isinstance(operation, str) or not re.fullmatch(r'fcos-preview-email-[1-9][0-9]*-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', operation):
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
    ledger = directory / 'preview-coordination-consumption'
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
    record = {'schemaVersion': 1, 'kind': 'fcos_exact_04ee_permanent_coordination_consumption',
              'operationId': operation, 'binding': binding, 'bindingTextSha256': hashlib.sha256(binding_text.encode()).hexdigest(),
              'helperSha256': HELPER_SHA256, 'lease': lease, 'consumedAt': int(time.time() * 1000),
              'possibleSigningOrPublication': True, 'replayForbidden': True, 'providerAuthorityGranted': False}
    guard.create_json(path, record)  # O_EXCL, file fsync and directory fsync.
    raw = guard.read_regular(path)
    return {'lease': lease, 'consumptionSha256': hashlib.sha256(raw).hexdigest(), 'operationId': operation}

def main():
    # No argument/flag/environment variable can install live authority.
    if not PROTECTED_ACTIONS_INSTALLED or sys.argv[1:] != ['--claim']:
        raise ValueError('protected actions not installed')
    raw = sys.stdin.buffer.read(32769)
    if len(raw) > 32768:
        raise ValueError('binding size')
    print(json.dumps(claim_and_consume(raw.decode(), WORKFLOW, BASE, HELPER), separators=(',', ':')))

if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Coordination unavailable; retained operation/lease requires root GET-only recovery.', file=sys.stderr)
        sys.exit(1)
