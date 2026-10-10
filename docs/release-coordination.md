# Coordinated protected release executor

This change adds an executable shared-lease path for the existing manual Production
and historical compatibility executors. It does not activate either environment.
The independent source controls, actual personal environment review, dedicated
credentials and new `FCOS_RELEASE_COORDINATION_ENABLED=true` environment variable
are all required. Repository variables alone cannot satisfy the live collector.
No automatic trigger, approval, credential setup or lease release is added.

The protected job uses a native Node24 action from its exact protected-main
checkout. The GitHub runner provides the artifact identity directly to that
process; it is never copied into shell outputs or `GITHUB_ENV`. The locked
`@actions/artifact` package creates one immutable intent archive for the exact
run, first attempt, job, environment, source, Preview, previous Production and
original readiness. Actual digest and archive readback must agree. Every release
control, the action, issuer, verifier, transport and Python ledger is covered by
the release and successor configuration fingerprints.

The waiting job and the local coordinator proceed within the minimum original
30-minute run/job/intent/readiness deadline, polling every ten seconds. The local
command is `node scripts/release-coordinator-local.mjs --issue-approved <UUID>`;
`--plan` remains pure. The private canonical approval directory and exact action
must already be root-admitted and separately reviewed. Action admission retains
the original 30-minute action and 45-minute private-readiness clocks. Approval
records are data, not authentication of a human. Actual GitHub API reads must
prove the pinned operator personally approved this exact environment job.

Before any lease claim, private read or provider write, both the issuer and the
fixed Python entry enforce the action and current raw committed control bytes.
One bounded Git blob batch checks scripts, configuration, workflows, actions,
Codex controls, AGENTS and dependency manifests independently of index flags.
The Python entry accepts only `--claim-approved <UUID>` and independently calls
the fixed read-only admission path; caller-provided binding JSON cannot claim.
Only the unchanged canonical WriteLease helper serializes live writes.

The canonical lease is claimed before an exclusive permanent operation record,
then before private-key access, signing or the sole create-only per-run environment
variable. Signatures use the separate `FCOS-PRODUCTION-COORDINATION-GRANT-V1` domain.
The signed grant authorizes coordination only. The hosted process must create and
read back a separate immutable consumption archive before it gains an opaque
in-memory capability. Stage and promotion consume separate one-use capability
phases and recheck actual approval, main, source pins, OIDC and both archives.
Existing source/evidence, staged build, runtime, previous Production, public
readback and rollback requirements continue to apply.

Any uncertain signing/publication, duplicate artifact, failed recheck or provider
outcome retains permanent consumption and the canonical lease. There is no retry,
overwrite, timeout stealing, renewal or automatic resolution. Root must reconcile
the original job and actual provider outcome through GET-only recovery before
resolving the lease. Resolution never removes consumption. An SDK invocation may
internally retry its service requests; it is not claimed to be a single HTTP call.

## First rollout and final application ordering

The existing exact04ee Preview and compatibility execution refusals and disabled
Preview ledger are preserved. Actual protected backend exclusivity, concurrent
duplicate, crash recovery and immutable archive readback are still prerequisites
for any later exact04ee Preview POST activation. This source change and offline
fixtures do not supply those hosted proofs or authorize private actions.

The immutable historical email contract, exact04ee source/signer admission,
all15 real module reads, normal-role and personal private readiness, disposable
DEVEE NomB, stronger compatibility and cleanup/rollback remain mandatory. After
the authorized exact04ee rollout, actual observed Production identity, runtime
and signer behavior must be captured and reviewed before a final2f4 signer or
baseline successor can be admitted. The current final2f4 signer remains refused;
an observed deployment ID, real artifact/run IDs and new baseline evidence cannot
be filled from fixtures or inferred from staging. No final signing capability or
historical unknown-value equality is invented by this patch.

The separate accepted19-status/16-supplier application composition derives from
its explicit2f4 foundation. It keeps separate financial scope fingerprints and
`existingUi:false`; it is not restored wholesale into the protected harness.
Controls can be reviewed and integrated into the existing harness PR while that
application candidate is prepared independently. Final source admission remains
after observed Production, so these runtime dependencies cannot be parallelized.

## Included artifact-only backend proof

`release-coordination-proof.yml` is manual and disabled until its exact protected
main SHA and `FCOS_RELEASE_COORDINATION_PROOF_ENABLED` are separately admitted.
The actual environment must contain `FCOS_RELEASE_COORDINATION_PROOF_ACTION`,
whose `root_admitted_artifact_coordination_proof` binding fixes repository,
harness SHA, run ID and job ID, original action time and authorization hash,
and the root-held canonical production-objective lease. The actual pinned human
must approve this run in `fcos-production-release`. The proof code neither claims
nor resolves that lease. Root must keep it held through actual terminal/archive
readback and then reconcile the original action. Artifact writes are coordinated
writes; they are not exempt from the shared lease.

The native action exercises two concurrent create-only uploads to one name,
requires one success and one rejection, then requires a later duplicate rejection
and unchanged archive bytes. A separate child uploads the crash artifact and
exits86 before returning its ID to its parent. The parent recovers only by GET,
checks the actual archive and rejects a retry. Original run/action/job clocks,
real API metadata, signed OIDC, exact source, personal approval and both archive
readbacks are verified. No artifact is deleted or overwritten. The result is
observational evidence with `grantsActivation:false`, not an automatic guard
switch. It has no Vercel token, keychain access, deployment or lease mutation.
Offline backend tests validate the checking logic only; actual hosted evidence
still has to be collected after separate admission.
