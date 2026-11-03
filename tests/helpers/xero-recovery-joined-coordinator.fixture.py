"""Local coordination only. Grants no provider, financial or human authority."""
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import uuid
from types import MappingProxyType

OBJECTIVE_STATES = {"active", "waiting_dependency", "waiting_human", "failed_recoverable", "complete"}
# Current admission applies to NEW claims/worker dispatch only. Historical
# lease, intent, approval and outcome owners are never rewritten or adopted.
OWNERS = {"production": "01a0f08b-7fcb-7870-9edc-343e16052b62", "reconciliation": "01a0f08b-7fcb-7870-9edc-343e16052b62"}
HISTORICAL_OWNERS = MappingProxyType({"reconciliation": ("01a0b0e2-b1af-7bf0-963d-3138c42648e3",)})
# This is orchestration provenance, not provider/financial action authority.
OWNER_TRANSITION_AUTHORITY = MappingProxyType({
    "path": "/Users/vincex/Documents/FCOS/outputs/reconciliation-20261018/chat-consolidation/handoff.json",
    "sha256": "50e0fac896682148ab34239b29e3d79db6a019cb240546c7f3fe79848b985b7a",
    "kind": "direct_human_single_chat_consolidation_v1",
    "ownershipOrchestrationOnly": True,
    "providerAuthorityGranted": False,
    "financialAuthorityGranted": False,
})

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


# This is preparation for a NEW explicit human cancellation decision, never a
# no-submission/success claim. It adds no automatic expiry or generic exception.
CANCELLED_EXACT_B53 = "verified_human_cancelled_exact_b53_partial_asof_unknown_submission"
B53_LEASE = {'epoch': 'production-reconciliation-20261005', 'objective': 'production', 'ownerThreadId': '01a0f08b-7fcb-7870-9edc-343e16052b62', 'operationId': 'exact04ee-pr114-permission-corrected-three-successor-b53f1cbd-80ca-4f28-ac48-698a21e35b29', 'bindingSha256': 'c87ec2122f504210635956ed0e09af244d91367092e08edf724adb776798a727', 'leaseId': '71737503-1b83-4e2b-951a-d02dffb00bcd', 'coordinationOnly': True, 'providerAuthorityGranted': False, 'uncertainOutcomeRequiresReadback': True}
B53_FIXED_EVIDENCE = [{'path': '/Users/vincex/Documents/FCOS/.fcos-cli/outputs/overnight-20261004/resumed-indefinite-20261004/schedule-consolidation-20261004/production-reconciliation-coordinator-20261005/rapid-release-optimization-20261010/production-material-transport-20261011/fresh-preview-provisioning/owned-cohort-replacement-successor/pr114-permission-corrected-three-successor/actual-b53f1cbd-80ca-4f28-ac48-698a21e35b29/root-actual-before-boundary.json', 'sha256': '5e31ffa7a8062b5e53443b375308334d8d9c04aa838eefa19d0dae777e1a92c7'}, {'path': '/Users/vincex/Documents/FCOS/.fcos-cli/outputs/overnight-20261004/resumed-indefinite-20261004/schedule-consolidation-20261004/production-reconciliation-coordinator-20261005/rapid-release-optimization-20261010/production-material-transport-20261011/fresh-preview-provisioning/owned-cohort-replacement-successor/pr114-permission-corrected-three-successor/actual-b53f1cbd-80ca-4f28-ac48-698a21e35b29/root-actual-quarantine-boundary.json', 'sha256': 'c0b7d7f85d558061bddbae8c0c21312f225ebe80f77f557a1bae6a11078e3a2d'}, {'path': '/Users/vincex/Documents/FCOS/.fcos-cli/outputs/overnight-20261004/resumed-indefinite-20261004/schedule-consolidation-20261004/production-reconciliation-coordinator-20261005/rapid-release-optimization-20261010/production-material-transport-20261011/fresh-preview-provisioning/owned-cohort-replacement-successor/pr114-permission-corrected-three-successor/actual-b53f1cbd-80ca-4f28-ac48-698a21e35b29/root-actual-second-quarantine-boundary.json', 'sha256': 'c0742ab13c91ee11bc28d56618c77d35686170dfb299f246ec010ef26d09dcc8'}, {'path': '/Users/vincex/Documents/FCOS/.fcos-cli/outputs/overnight-20261004/resumed-indefinite-20261004/schedule-consolidation-20261004/production-reconciliation-coordinator-20261005/rapid-release-optimization-20261010/production-material-transport-20261011/fresh-preview-provisioning/owned-cohort-replacement-successor/pr114-permission-corrected-three-successor/actual-b53f1cbd-80ca-4f28-ac48-698a21e35b29/root-actual-quarantine-readback.json', 'sha256': 'a14eb37510d7a3c6b828fafd2a979c2d3f57aaa03037cd02fa0d3d41bd5c24b8'}, {'path': '/Users/vincex/Documents/FCOS/.fcos-cli/outputs/overnight-20261004/resumed-indefinite-20261004/schedule-consolidation-20261004/production-reconciliation-coordinator-20261005/rapid-release-optimization-20261010/production-material-transport-20261011/fresh-preview-provisioning/owned-cohort-replacement-successor/pr114-permission-corrected-three-successor/actual-b53f1cbd-80ca-4f28-ac48-698a21e35b29/root-actual-second-quarantine-readback.json', 'sha256': '78eb5e46c6f866d2ab77aa63506380126b22ef7e573897eae29518d6b26021b7'}, {'path': '/Users/vincex/Documents/FCOS/.fcos-cli/outputs/overnight-20261004/resumed-indefinite-20261004/schedule-consolidation-20261004/production-reconciliation-coordinator-20261005/rapid-release-optimization-20261010/production-material-transport-20261011/fresh-preview-provisioning/owned-cohort-replacement-successor/pr114-permission-corrected-three-successor/actual-b53f1cbd-80ca-4f28-ac48-698a21e35b29/root-actual-quarantine-audit.json', 'sha256': '23f179255540144b5fabc6469344a4e44f94a1499bb8580479f6bf4252d45f79'}, {'path': '/Users/vincex/Documents/FCOS/.fcos-cli/outputs/overnight-20261004/resumed-indefinite-20261004/schedule-consolidation-20261004/production-reconciliation-coordinator-20261005/rapid-release-optimization-20261010/production-material-transport-20261011/fresh-preview-provisioning/owned-cohort-replacement-successor/pr114-permission-corrected-three-successor/actual-b53f1cbd-80ca-4f28-ac48-698a21e35b29/native-execution-finish.json', 'sha256': 'c3bcd6b9b7ef095dc6dafde5219ddc9cc1aeadd40cde2026fb2ae52d3be208df'}, {'path': '/Users/vincex/Documents/FCOS/.fcos-cli/exact04ee-pr114-permission-corrected-three-successor/b53f1cbd-80ca-4f28-ac48-698a21e35b29/state.json', 'sha256': '178de352e42da197fabfff8cc1c6599abfa4d873513efaa99e3d92ec1df561a8'}, {'path': '/Users/vincex/Documents/FCOS/.fcos-cli/exact04ee-pr114-permission-corrected-three-successor/b53f1cbd-80ca-4f28-ac48-698a21e35b29/create-7-intent.json', 'sha256': '30494f742b78a5bb4ac731622434511318c0f4df64d124bf57ede8e49c91b4cf'}, {'path': '/Users/vincex/Documents/FCOS/.fcos-cli/exact04ee-pr114-permission-corrected-three-successor/b53f1cbd-80ca-4f28-ac48-698a21e35b29/delete-8RYu3ykTyWGNYvD3-intent.json', 'sha256': '7949a1bdca67220cbec016ca14896d8f2d13cfdb3fa511bc2ca1c1f682a37ceb'}, {'path': '/Users/vincex/Documents/FCOS/.fcos-cli/exact04ee-pr114-permission-corrected-three-successor/b53f1cbd-80ca-4f28-ac48-698a21e35b29/delete-YQ7LwQ1dOXN1om12-intent.json', 'sha256': '880ddc9b765bcfdc2c465c32196b42125225a7f7246726e7de43bb3488a5c0ce'}, {'path': '/Users/vincex/Documents/FCOS/.fcos-cli/exact04ee-pr114-permission-corrected-three-successor/b53f1cbd-80ca-4f28-ac48-698a21e35b29/delete-xDAe7YbFhrdfUApe-intent.json', 'sha256': '58bac5b003ab1b831f52a2a1eac24c756b1a453498d0aad94b9a07293ae82f4c'}, {'path': '/Users/vincex/Documents/FCOS/.fcos-cli/outputs/overnight-20261004/resumed-indefinite-20261004/schedule-consolidation-20261004/production-reconciliation-coordinator-20261005/exact04ee-pr114-permission-corrected-three-successor-consumption/c9b45118f3fe7b99aab67c906e6b49f14d9f6e24478e4f3dc9bae82fed920034.json', 'sha256': '1f8726ffa0e01bbff62ff50172fa4277288fc1c8c2ef660d43e700ee3c96c927'}, {'path': '/Users/vincex/Documents/FCOS/.fcos-cli/outputs/overnight-20261004/resumed-indefinite-20261004/schedule-consolidation-20261004/production-reconciliation-coordinator-20261005/exact04ee-pr114-permission-corrected-three-successor-consumption/nonce-aad9906b2122b8f1aa9233fc4b52a9bfaeb63bcdf709539817b24b8239ad4dd9.json', 'sha256': '1f8726ffa0e01bbff62ff50172fa4277288fc1c8c2ef660d43e700ee3c96c927'}, {'path': '/Users/vincex/Documents/FCOS/.fcos-cli/outputs/overnight-20261004/resumed-indefinite-20261004/schedule-consolidation-20261004/production-reconciliation-coordinator-20261005/exact04ee-pr114-permission-corrected-three-source-consumption-85b4090f448ba1043c6a6c3161a2ed4977f3494fa4ce2037a47c743578baadfd.json', 'sha256': '1f8726ffa0e01bbff62ff50172fa4277288fc1c8c2ef660d43e700ee3c96c927'}]
B53_FLAGS = {"originalSubmissionStatus": "unknown", "possibleLateEffect": True,
    "absenceAsOfReadbackOnly": True, "originalIntentConsumedGetOnly": True,
    "requestedCohortComplete": False, "successClaim": False,
    "noSubmissionClaim": False, "lateEffectImpossibleClaim": False,
    "successorAuthorityGranted": False, "deadlineExtensionGranted": False}

def validate_exact_b53_cancellation(lease, result, now_ms):
    if lease != B53_LEASE:
        raise ValueError("exact b53 production coordination lease only")
    c = result.get("cancelledExactB53Partial")
    if not isinstance(c, dict) or any(c.get(k) != v for k,v in B53_FLAGS.items()):
        raise ValueError("unknown partial outcome must remain explicit")
    if c.get("fixedActualEvidence") != B53_FIXED_EVIDENCE:
        raise ValueError("exact four intents, state, readbacks, audit and consumption required")
    for ref in B53_FIXED_EVIDENCE:
        authenticated_reference(ref)
    state = authenticated_reference(next(r for r in B53_FIXED_EVIDENCE if r["path"].endswith("/state.json")))
    if (state.get("phase") != "quarantined_get_only" or state.get("pendingIndex") != 7
            or state.get("records") != [] or state.get("claim",{}).get("lease") != lease
            or state.get("removedOwnedRecordIds") != ["xDAe7YbFhrdfUApe","8RYu3ykTyWGNYvD3","YQ7LwQ1dOXN1om12"]):
        raise ValueError("original partial state changed")
    parent = Path(next(r for r in B53_FIXED_EVIDENCE if r["path"].endswith("/state.json"))["path"]).parent
    if {p.name for p in parent.glob("*-intent.json")} != {"create-7-intent.json", "delete-xDAe7YbFhrdfUApe-intent.json", "delete-8RYu3ykTyWGNYvD3-intent.json", "delete-YQ7LwQ1dOXN1om12-intent.json"}:
        raise ValueError("unreviewed original action intent")
    fresh = authenticated_reference(c.get("freshCompleteBoundary"))
    old = authenticated_reference(next(r for r in B53_FIXED_EVIDENCE if r["path"].endswith("/root-actual-second-quarantine-boundary.json")))
    observed = fresh.get("observedAt")
    if (not isinstance(observed,int) or not 0 <= now_ms-observed <= 600000
            or observed < old["observedAt"] or any(fresh.get(k)!=v for k,v in old.items() if k!="observedAt")
            or set(fresh)!=set(old) or len(fresh.get("settings",[]))!=429):
        raise ValueError("fresh exact protected state absence required")
    consent = authenticated_reference(c.get("directHumanCancellationAuthority"))
    guard_sha = hashlib.sha256(read_regular(__file__)).hexdigest()
    at = consent.get("firstObservedAt")
    if (consent.get("kind") != "direct_human_exact_b53_coordination_cancellation_authority"
            or consent.get("lease") != lease or consent.get("guardSha256") != guard_sha
            or consent.get("authorizedBy") != "hocheunglai-oss" or not consent.get("actualHumanReply")
            or consent.get("sourceCommit") != "ad57645e25de3cfced711738ee0401f391da3394"
            or consent.get("explicitCancellationAuthorized") is not True
            or consent.get("actualReplyProvenanceReviewedByRoot") is not True
            or not isinstance(at,int) or not 0 <= now_ms-at < 2700000
            or consent.get("originalExpiresAt") != at+2700000
            or any(consent.get(k)!=v for k,v in B53_FLAGS.items())):
        raise ValueError("new exact human cancellation consent and readiness required")
    reviewers=set()
    for role in ["root","independent"]:
        review=authenticated_reference(c.get(role+"GuardReview"))
        if (review.get("kind")!="exact_b53_cancellation_guard_review" or review.get("role")!=role
                or review.get("accepted") is not True or review.get("guardSha256")!=guard_sha
                or review.get("onlyAddedOutcome")!=CANCELLED_EXACT_B53
                or not isinstance(review.get("reviewedAt"),int) or not 0<review["reviewedAt"]<=at
                or not review.get("reviewerId") or review["reviewerId"] in reviewers):
            raise ValueError("two preceding exact guard reviews required")
        reviewers.add(review["reviewerId"])


# Exact data-only hosted upload cancellation. It preserves uncertainty and
# requires a NEW direct-human, code-bound decision; it cannot cancel remotely.
CANCELLED_EXACT_RUNTIME_UPLOAD = "verified_human_cancelled_exact_runtime_material_upload_asof_unknown_submission"
RUNTIME_UPLOAD_LEASE = {'epoch': 'production-reconciliation-20261005', 'objective': 'production', 'ownerThreadId': '01a0f08b-7fcb-7870-9edc-343e16052b62', 'operationId': 'exact04ee-pr114-current-material-publication-and-one-preview-6dd230bc-dc3a-4928-bc82-de6f9b2e3d80', 'bindingSha256': 'd0d033201cb78b6c8edc163bfb1b25cd8bbb3b15292d743affadc83f225f4cbc', 'leaseId': '1a917c48-e588-4c20-88ae-83fc0a162810', 'coordinationOnly': True, 'providerAuthorityGranted': False, 'uncertainOutcomeRequiresReadback': True}
RUNTIME_UPLOAD_FIXED_EVIDENCE = [{'path': '/Users/vincex/Documents/FCOS/.fcos-cli/outputs/overnight-20261004/resumed-indefinite-20261004/schedule-consolidation-20261004/production-reconciliation-coordinator-20261005/rapid-release-optimization-20261010/production-material-transport-20261011/fresh-preview-provisioning/owned-cohort-replacement-successor/pr114-current-ten-three-refresh-20261013/actual-6dd230bc-dc3a-4928-bc82-de6f9b2e3d80/public-preview-continuation/public-action-plan.json', 'sha256': 'd0d033201cb78b6c8edc163bfb1b25cd8bbb3b15292d743affadc83f225f4cbc'}, {'path': '/Users/vincex/Documents/FCOS/.fcos-cli/outputs/overnight-20261004/resumed-indefinite-20261004/schedule-consolidation-20261004/production-reconciliation-coordinator-20261005/rapid-release-optimization-20261010/production-material-transport-20261011/fresh-preview-provisioning/owned-cohort-replacement-successor/pr114-current-ten-three-refresh-20261013/actual-6dd230bc-dc3a-4928-bc82-de6f9b2e3d80/public-preview-continuation/one-dispatch-intent.json', 'sha256': '84b49ae58f39c10abe2510f97b040fc5d4ab53c473939fd12cf4ab701c3a8ebe'}, {'path': '/Users/vincex/Documents/FCOS/.fcos-cli/outputs/overnight-20261004/resumed-indefinite-20261004/schedule-consolidation-20261004/production-reconciliation-coordinator-20261005/rapid-release-optimization-20261010/production-material-transport-20261011/fresh-preview-provisioning/owned-cohort-replacement-successor/pr114-current-ten-three-refresh-20261013/actual-6dd230bc-dc3a-4928-bc82-de6f9b2e3d80/public-preview-continuation/root-actual-public-setup-and-dispatch-acceptance.json', 'sha256': '8d807becdc75b39ac1f9c582f3d17e8e8708fa9f707cb337a0136cffa7579ff7'}, {'path': '/Users/vincex/Documents/FCOS/.fcos-cli/outputs/overnight-20261004/resumed-indefinite-20261004/schedule-consolidation-20261004/production-reconciliation-coordinator-20261005/rapid-release-optimization-20261010/production-material-transport-20261011/fresh-preview-provisioning/owned-cohort-replacement-successor/pr114-current-ten-three-refresh-20261013/actual-6dd230bc-dc3a-4928-bc82-de6f9b2e3d80/public-preview-continuation/reviewed-reply-20261013T084552SGT/actual-review-and-producer-boundary.json', 'sha256': 'fbb3a1225b1475052e42e9e58aac41bfd338fda92782428665013eaa8402f631'}, {'path': '/Users/vincex/Documents/FCOS/.fcos-cli/outputs/overnight-20261004/resumed-indefinite-20261004/schedule-consolidation-20261004/production-reconciliation-coordinator-20261005/rapid-release-optimization-20261010/production-material-transport-20261011/fresh-preview-provisioning/owned-cohort-replacement-successor/pr114-current-ten-three-refresh-20261013/actual-6dd230bc-dc3a-4928-bc82-de6f9b2e3d80/public-preview-continuation/reviewed-reply-20261013T084552SGT/actual-terminal-material-failure-excerpts.json', 'sha256': '1957b66b900061d1876ee08536347e1d9cc7e1a2b6e99c2e1c5d761090b07d5d'}, {'path': '/Users/vincex/Documents/FCOS/.fcos-cli/outputs/overnight-20261004/resumed-indefinite-20261004/schedule-consolidation-20261004/production-reconciliation-coordinator-20261005/rapid-release-optimization-20261010/production-material-transport-20261011/fresh-preview-provisioning/owned-cohort-replacement-successor/pr114-current-ten-three-refresh-20261013/actual-6dd230bc-dc3a-4928-bc82-de6f9b2e3d80/public-preview-continuation/reviewed-reply-20261013T084552SGT/actual-terminal-upload-readback.json', 'sha256': 'b980692c3f9541f803b6b49c6011a84a90f8bf73092b3ac8778fbaf7ecb1467b'}]
RUNTIME_UPLOAD_FLAGS = {"originalSubmissionStatus": "unknown", "possibleLateEffect": True,
    "absenceAsOfReadbackOnly": True, "originalIntentConsumedGetOnly": True,
    "successClaim": False, "noSubmissionClaim": False, "lateEffectImpossibleClaim": False,
    "remoteCancellationClaim": False, "successorAuthorityGranted": False, "deadlineExtensionGranted": False}

def validate_exact_runtime_upload_cancellation(lease, result, now_ms):
    import math
    if lease != RUNTIME_UPLOAD_LEASE:
        raise ValueError("exact original hosted material upload lease required")
    c = result.get("cancelledExactRuntimeMaterialUpload")
    if not isinstance(c, dict) or any(c.get(k) != v for k,v in RUNTIME_UPLOAD_FLAGS.items()):
        raise ValueError("original upload uncertainty must remain explicit")
    if c.get("fixedActualEvidence") != RUNTIME_UPLOAD_FIXED_EVIDENCE:
        raise ValueError("exact original upload evidence required")
    evidence = [authenticated_reference(ref) for ref in RUNTIME_UPLOAD_FIXED_EVIDENCE]
    plan, intent, accepted, boundary, diagnostic, original = evidence
    run_id, job_id, source = 38328488261, 115072605709, "ad57645e25de3cfced711738ee0401f391da3394"
    if (plan.get("operationId") != lease["operationId"] or plan.get("noSigning") is not True
        or plan.get("noPreviewDeploymentSubmission") is not True or plan.get("noProduction") is not True
        or plan.get("noFinancialWrites") is not True or intent.get("lease") != lease
        or intent.get("maximumAttempts") != 1 or intent.get("noReplay") is not True
        or accepted.get("runId") != run_id or accepted.get("jobId") != job_id
        or accepted.get("providerWrites") != 7 or accepted.get("lease") != lease):
        raise ValueError("original public data-only action binding required")
    run = boundary.get("run", {}); jobs = boundary.get("jobs", {}).get("jobs", [])
    if (run.get("id") != run_id or run.get("head_sha") != source or run.get("run_attempt") != 1
        or run.get("status") != "completed" or run.get("conclusion") != "failure"
        or len(jobs) != 1 or jobs[0].get("id") != job_id or jobs[0].get("conclusion") != "failure"):
        raise ValueError("exact terminal original producer required")
    steps = jobs[0].get("steps", [])
    upload = [v for v in steps if v.get("name") == "Persist immutable exact04ee runtime materials"]
    downstream = [v for v in steps if v.get("name") in {"Prepare reviewed metadata and exact Preview-only request",
        "Persist immutable intent before any deployment request",
        "Admit exact coordination, verify original intent and submit one Preview request"}]
    if len(upload) != 1 or upload[0].get("conclusion") != "failure" or len(downstream) != 3 or any(v.get("conclusion") != "skipped" for v in downstream):
        raise ValueError("failed material upload and skipped deployment steps required")
    records = []
    for line in diagnostic.get("lines", []):
        offset = line.find('{"schemaVersion"')
        if offset >= 0:
            try: records.append(json.loads(line[offset:]))
            except (ValueError, TypeError): raise ValueError("invalid primitive failure diagnostic")
    expected = {"schemaVersion": 1, "kind": "fcos_runtime_material_failure", "phase": "artifact_upload",
        "readClass": "none", "httpStatus": None, "cliExitCode": None}
    if records != [expected] or diagnostic.get("runId") != run_id or diagnostic.get("jobId") != job_id:
        raise ValueError("exact actual upload-phase diagnostic required")
    fresh = authenticated_reference(c.get("freshOwnerReadback"))
    observed = fresh.get("observedAt")
    if (fresh.get("kind") != "actual_original_owner_terminal_upload_get_only_readback"
        or fresh.get("ownerLogin") != "hocheunglai-oss" or fresh.get("repositoryId") != 1278654816
        or type(observed) not in (int, float) or not math.isfinite(observed)
        or observed > now_ms or now_ms - observed > 600000
        or observed < original.get("observedAt", now_ms + 1)
        or fresh.get("run", {}).get("id") != run_id or fresh["run"].get("head_sha") != source
        or fresh["run"].get("run_attempt") != 1 or fresh["run"].get("status") != "completed"
        or fresh["run"].get("conclusion") != "failure"
        or fresh.get("artifacts", {}).get("total_count") != 0 or fresh["artifacts"].get("artifacts") != []
        or fresh.get("pending") != [] or fresh.get("artifactAbsenceIsAsOfOnly") is not True
        or fresh.get("submissionOrFinalizationNotProven") is not True or fresh.get("noReplay") is not True):
        raise ValueError("fresh original-owner absent-as-of GET readback required")
    human = authenticated_reference(c.get("humanCancellationAuthority"))
    at = human.get("authorizedAt")
    if (human.get("kind") != "direct_human_exact_runtime_material_upload_coordination_cancellation"
        or human.get("authorizedBy") != "hocheunglai-oss" or human.get("lease") != lease
        or human.get("runId") != run_id or human.get("jobId") != job_id or human.get("sourceCommit") != source
        or human.get("helperSha256") != hashlib.sha256(read_regular(__file__)).hexdigest()
        or type(at) not in (int, float) or not math.isfinite(at)
        or at < original.get("observedAt", now_ms + 1) or at > now_ms or now_ms - at > 1800000
        or human.get("localCoordinationCancellationAuthorized") is not True
        or human.get("preserveUnknownUploadOutcome") is not True
        or any(human.get(k) is not False for k in ["remoteCancellationAuthorized", "newUploadAuthorized",
            "signingAuthorized", "previewExecutionAuthorized", "productionAuthorized", "financialAuthorityGranted"])):
        raise ValueError("new exact code-bound direct-human local cancellation authority required")

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
            elif result.get("outcome") == CANCELLED_EXACT_B53:
                import time
                validate_exact_b53_cancellation(lease, result, time.time() * 1000)
            elif result.get("outcome") == CANCELLED_EXACT_RUNTIME_UPLOAD:
                import time
                validate_exact_runtime_upload_cancellation(lease, result, time.time() * 1000)
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
