"""Local coordination only. Grants no provider, financial or human authority."""
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import uuid

OBJECTIVE_STATES = {"active", "waiting_dependency", "waiting_human", "failed_recoverable", "complete"}
OWNERS = {"production": "01a0f08b-7fcb-7870-9edc-343e16052b62", "reconciliation": "01a0b0e2-b1af-7bf0-963d-3138c42648e3"}

def read_regular(path):
    path = Path(path)
    for parent in [path, *path.parents]:
        if parent.is_symlink():
            raise ValueError("symlink rejected")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError("regular single-link file required")
        return stream.read()

def create_json(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    fd = os.open(Path(path).parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def binding_valid(value):
    return isinstance(value, str) and len(value) == 64 and all(c in "0123456789abcdef" for c in value)

def ready_batch_requested(direct_user_text):
    # Call only with an actual direct-human message. Text cannot prove its origin.
    return isinstance(direct_user_text, str) and direct_user_text.strip().lower() in {"ready", "i am ready", "i'm ready"}

def queue_key(objective, action_type, target, binding):
    if objective not in OWNERS or not binding_valid(binding):
        raise ValueError("invalid queue binding")
    return hashlib.sha256(json.dumps([objective, action_type, target, binding], separators=(",", ":")).encode()).hexdigest()

def dispatch_needed(previous, binding, worker_running, useful_unit_available):
    if not binding_valid(binding):
        raise ValueError("invalid dispatch binding")
    if worker_running or not useful_unit_available:
        return False
    if previous is None:
        return True
    if not isinstance(previous, dict) or previous.get("status") not in {"complete", "failed_terminal", "cancelled_verified"}:
        return False
    if not binding_valid(previous.get("bindingSha256")):
        return False
    if previous.get("threadId") != OWNERS["reconciliation"] or not isinstance(previous.get("operation"), str) or not previous["operation"]:
        return False
    proof = previous.get("terminalOutcomeProof")
    if not isinstance(proof, dict) or not isinstance(proof.get("path"), str) or not proof["path"] or not binding_valid(proof.get("sha256")):
        return False
    # Root must authenticate this actual terminal proof; labels alone grant no dispatch.
    return previous["bindingSha256"] != binding

def all_complete(coordinator):
    for objective in OWNERS:
        item = coordinator["objectives"][objective]
        if item["status"] != "complete" or not item.get("completionProofs"):
            return False
    return True


CANCELLED_PUBLIC_PREVIEW = "verified_cancelled_public_preview_create_no_change_asof"

def authenticated_reference(reference):
    if not isinstance(reference, dict) or not binding_valid(reference.get("sha256")) or not isinstance(reference.get("path"), str):
        raise ValueError("exact cancellation reference required")
    raw = read_regular(reference["path"])
    if hashlib.sha256(raw).hexdigest() != reference["sha256"]:
        raise ValueError("cancellation evidence changed")
    return json.loads(raw)

def validate_public_preview_cancellation(lease, result, now_ms):
    # A cancelled public create is not a no-submission or successful-write claim.
    # This exception cannot resolve financial, Production, deployment or private
    # operations. Root still authenticates actual provider provenance separately.
    c = result.get("cancelledPublicPreviewCreate")
    if lease.get("objective") != "production" or not isinstance(c, dict):
        raise ValueError("bounded public Preview cancellation only")
    required = {"originalSubmissionStatus": "unknown", "originalIntentConsumedGetOnly": True,
                "successClaim": False, "noSubmissionClaim": False,
                "lateEffectImpossibleClaim": False, "absenceAsOfReadbackOnly": True}
    if any(c.get(k) != v for k, v in required.items()):
        raise ValueError("cancellation semantics mismatch")
    intent = authenticated_reference(c.get("originalIntent"))
    before = authenticated_reference(c.get("originalBeforeBoundary"))
    after = authenticated_reference(c.get("actualAfterReadback"))
    audit = authenticated_reference(c.get("audit"))
    terminal = authenticated_reference(c.get("localProcessTermination"))
    op = intent.get("operation", {}); body = op.get("body", {})
    if intent.get("kind") != "durable_exact745e_mutation_intent_v1" or intent.get("stage") != "configure" or intent.get("identity") != lease["bindingSha256"] or intent.get("leaseId") != lease["leaseId"]:
        raise ValueError("original cancellation intent binding mismatch")
    if lease["operationId"] != "exact745e-configure-" + lease["bindingSha256"]:
        raise ValueError("original public configure operation required")
    if op.get("action") != "configure" or op.get("method") != "POST" or set(body) != {"key", "value", "type", "target", "gitBranch"} or body.get("key") != op.get("key") or body.get("type") != "plain" or body.get("target") != ["preview"] or not isinstance(body.get("value"), str) or not isinstance(body.get("gitBranch"), str) or not body["gitBranch"].startswith("codex/"):
        raise ValueError("public create-only Preview scope required")
    if intent.get("sourceCommit") != "745e20cf7059c5e01472e9b64b43e7f253e34a19" or body.get("key") != "VITE_FCOS_ENABLE_FCUNO_OIDC" or body.get("value") != "true" or body.get("gitBranch") != "codex/compatibility-successor-source-gate-20261005":
        raise ValueError("exact original public guard cancellation scope required")
    if c["originalBeforeBoundary"]["sha256"] != intent.get("beforeBoundarySha256") or before.get("manifestSha256") != intent.get("manifestSha256") or before.get("checked", {}).get("guardCount") != 0:
        raise ValueError("exact absent before boundary required")
    if after.get("kind") != "exact_failed_configure_actual_readback_v1" or after.get("lease") != lease or after.get("originalIntentSha256") != c["originalIntent"]["sha256"] or after.get("originalAcceptanceSha256") != intent.get("acceptanceSha256") or after.get("sourceCommit") != intent.get("sourceCommit") or after.get("exactTargetRows") != [] or after.get("checked", {}).get("guardCount") != 0 or after.get("noPostReplay") is not True or after.get("ownershipOrSubmissionInferred") is not False:
        raise ValueError("exact absent after boundary required")
    b = before.get("boundary", {}); a = after.get("boundary", {})
    keys = ["actor", "repository", "main", "branchSha", "githubControls", "vercel", "projectConfiguration", "shared", "customEnvironments", "settings", "production"]
    if any(k not in b or k not in a or b[k] != a[k] for k in keys):
        raise ValueError("original foreign and Production preservation required")
    v = a["vercel"]
    route = "/v10/projects/" + v["projectId"] + "/env?teamId=" + v["teamId"]
    if op.get("route") != route or before["checked"]["foreignMetadataSha256"] != after["checked"]["foreignMetadataSha256"]:
        raise ValueError("target or full inventory binding mismatch")
    observed = a.get("observedAtMs")
    if not isinstance(observed, (int, float)) or observed < intent["atMs"] or observed > now_ms or now_ms - observed > 600000:
        raise ValueError("fresh nonfuture cancellation readback required")
    if terminal.get("kind") != "root_observed_original_local_invocation_termination_v1" or terminal.get("bindingSha256") != lease["bindingSha256"] or terminal.get("intentSha256") != c["originalIntent"]["sha256"] or terminal.get("nativeInvocationExited") is not True or terminal.get("exitCode") != 1 or terminal.get("providerSubmissionStatus") != "unknown" or terminal.get("originalReplayForbidden") is not True:
        raise ValueError("original local termination proof required")
    if audit.get("kind") != "exact_configure_read_only_iso_audit_v1" or audit.get("complete") is not True or audit.get("events") != [] or audit.get("code") is not None or audit.get("providerWrites") != 0 or audit.get("noPostReplay") is not True or audit.get("eventAbsenceDoesNotProveRejection") is not True or audit.get("identity", {}).get("actor") != v["actorId"] or audit.get("identity", {}).get("project") != v["projectId"] or audit.get("identity", {}).get("team") != v["teamId"]:
        raise ValueError("complete target-locked audit coverage required")
    from datetime import datetime
    window = audit.get("window", {})
    since = datetime.fromisoformat(window["since"].replace("Z", "+00:00")).timestamp() * 1000
    until = datetime.fromisoformat(window["until"].replace("Z", "+00:00")).timestamp() * 1000
    if since > intent["atMs"] or until < observed or until > now_ms:
        raise ValueError("original request audit window required")

class WriteLease:
    def __init__(self, workflow_path, directory):
        self.workflow_path = Path(workflow_path)
        self.directory = Path(directory)
        self.path = self.directory / "live-provider-write-lease.json"

    @contextlib.contextmanager
    def mutex(self):
        # OS mutex serializes claim/read/resolve; persistent lease survives crashes.
        for parent in [self.directory, *self.directory.parents]:
            if parent.is_symlink():
                raise ValueError("symlink rejected")
        fd = os.open(self.directory / "coordination-mutex.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode) or os.fstat(fd).st_nlink != 1:
                raise ValueError("invalid mutex file")
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            os.close(fd)

    def claim(self, objective, owner, operation_id, binding):
        if objective not in OWNERS or owner != OWNERS[objective] or not operation_id or not binding_valid(binding):
            raise ValueError("invalid owner or operation")
        with self.mutex():
            coordinator = json.loads(read_regular(self.workflow_path))["unifiedCoordinator"]
            item = coordinator["objectives"][objective]
            if coordinator["status"] != "active" or item["retired"] or item["status"] != "active":
                raise ValueError("objective unavailable")
            if item["ownerThreadId"] != owner or coordinator["writeLeasePath"] != str(self.path):
                raise ValueError("ownership or lease path mismatch")
            lease = {"epoch": coordinator["epoch"], "objective": objective, "ownerThreadId": owner,
                     "operationId": operation_id, "bindingSha256": binding, "leaseId": str(uuid.uuid4()),
                     "coordinationOnly": True, "providerAuthorityGranted": False,
                     "uncertainOutcomeRequiresReadback": True}
            create_json(self.path, lease)  # Existing lease is never expired, stolen or overwritten.
            return lease

    def resolve(self, lease, resolution_path, expected_sha256):
        if not binding_valid(expected_sha256):
            raise ValueError("invalid evidence digest")
        with self.mutex():
            current = json.loads(read_regular(self.path))
            if current != lease:
                raise ValueError("foreign or stale lease")
            raw = read_regular(resolution_path)
            if hashlib.sha256(raw).hexdigest() != expected_sha256:
                raise ValueError("evidence changed")
            result = json.loads(raw)
            if result.get("kind") != "reviewed_coordinator_write_resolution_v1":
                raise ValueError("reviewed resolution contract required")
            for key in ["epoch", "ownerThreadId", "operationId", "bindingSha256", "leaseId"]:
                if result.get(key) != lease[key]:
                    raise ValueError("resolution binding mismatch")
            if result.get("outcome") == CANCELLED_PUBLIC_PREVIEW:
                import time
                validate_public_preview_cancellation(lease, result, time.time() * 1000)
            elif result.get("outcome") not in {"verified_complete", "verified_no_provider_submission"}:
                raise ValueError("uncertain result retains lease")
            if not result.get("releaseOwnerMaterialAcceptance") or not result.get("actualActionReadbackProofs"):
                raise ValueError("actual action proof and acceptance required")
            # Caller must supply root-reviewed original-action readback closure; this
            # local utility authenticates the record, not provider provenance.
            receipt = {"lease": lease, "resolutionPath": str(resolution_path), "resolutionSha256": expected_sha256,
                       "coordinationOnly": True, "providerEvidenceIndependentlyVerifiedByThisHelper": False}
            history = self.directory / ("write-lease-resolution-" + lease["leaseId"] + ".json")
            if history.exists():
                if json.loads(read_regular(history)) != receipt:
                    raise ValueError("resolution history mismatch")
            else:
                create_json(history, receipt)
            os.unlink(self.path)
            fd = os.open(self.directory, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
            return receipt
