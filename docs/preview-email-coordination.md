# Exact04ee Preview coordination (source implementation only)

The direct-human implementation decision is pinned by SHA256
`4e2cd1fb08bf09fe07ee5d593276f1eac513278af91cea9427d79b0e16779455`.
It authorizes source and the existing Ed25519 attestation key's new signing
purpose design. It does not authorize private reads, signing, publication,
hosted artifact creation or a Preview. Those boundaries remain unconditionally
disabled in both the JavaScript constructor and the local Python entrypoint.

The new signature domain is `FCOS-EXACT-04EE-COORDINATION-GRANT-V1` followed
by a NUL byte. It is separate from connection identity and existing enrollment
receipt signatures. A grant is a necessary coordination gate; it does not replace
protected environment review, source/material admission, enrolled project-only
authority, the original build/signer/normal evidence, or human action approval.

The local fixed issuer verifies its operation-specific approval before any
authenticated constructor. It consumes the real source/material admission and
original protected Preview run, attempt, workflow, approved job and immutable
intent. It preserves the exact protected issuance-envelope UTF-8 bytes/hash and
all original timestamps. GitHub UTC seconds timestamps are accepted without
normalizing them into new strings. Current harness controls must be clean raw
blobs at the actual pinned commit, with all new issuer/verifier/collector,
workflow and dependency files included in the existing control closure.

The behind-guard issuer invokes the unchanged canonical `WriteLease` helper
whose SHA256 is `2bb8591f79b76b92f917ae7fcc1720d73757b613771812e9e220db015bdd1a18`.
It claims the canonical production-objective lease, then writes an exclusive
file with file and directory fsync in `preview-coordination-consumption/`.
The permanent filename hashes only the operation ID. Changing a binding,
timestamp, run, source or grant version cannot permit consumption again.
Consumption precedes private reads, signing and the sole fixed create-only
protected variable publication. Any failure after claim retains the lease;
there is no timeout release, renewal, reissue, overwrite or automatic resolution.
Only root-reviewed original job termination and actual provider closure can
resolve the canonical lease. Resolution does not remove permanent consumption.

The hosted fixed constructor uses real original-run identity, authenticated
target-locked reads, original archive decoding, real OIDC, enrolled bearer
checks and the pinned verifier key. Pure fixture data validators cannot mint its
opaque capability. Before a possible Preview request it invokes the official
locked `@actions/artifact` 6.3.1 transport with one exact claim file and no
overwrite/delete/application retry. The SDK can internally retry service
requests (up to five attempts); one SDK invocation is not one HTTP call.
Duplicate or uncertain claims remain GET-only. Authenticated immutable metadata,
archive digest and exact one-file payload readback are required before branding.

The workflow's exact04ee-only coordination step sits after durable intent and
before the Preview create step. It currently fails at the immutable disabled
guard. The existing exact04ee actual POST/write refusals also remain in place.
No local test proves hosted backend exclusivity, concurrent duplicate behavior,
crash recovery, retention/deletion guarantees or actual protected readback.
Those proofs, final root and independent material review, a committed protected
control closure and separately admitted live action are still absent.

The new disabled workflow step receives no secret environment variables.
Actual protected enablement would require separately admitted exact-source
action authority and explicit secret-step binding. An approval file or its
action-authorization evidence hash is data; it does not independently
authenticate a human or install any private action capability.

`node scripts/preview-email-coordinator-local.mjs --plan` is read-only. No flag,
environment variable, callback, test key, SDK response or accepted boolean can
install live actions. The existing enrollment executable and crypto bytes are
unchanged; this path has no provisioning, pin, enable or general mutation method.
