# Reviewed legacy cutover and financial bridge

`node scripts/hosted-release-cutover.mjs inspect <review-file> <review-byte-sha256> <accepted-helper-sha256>` is read-only. `fence` with those same arguments writes the reviewed permanent sentinel to the **actual canonical** `live-provider-write-lease.json` using the existing `coordination-mutex.lock` and OS `flock`, exclusive file creation, file fsync and directory fsync. Any existing lease, including an expired-looking or uncertain one, refuses the command and retains its exact bytes. The helper neither resolves a lease nor changes workflow/helper files. The sentinel deliberately lacks the original lease identity, so the old helper cannot resolve/delete it as an ordinary action lease. There is no unfence, overwrite, timeout, steal or retry path.

The review file has kind `fcos_hosted_cutover_review_v1`, `coordinationOnly:true`, `providerAuthorityGranted:false`, `nextEpoch`, `legacyEpoch`, `helper:{path,sha256}`, `workflow:{path,sha256}`, `leasePath`, `existingOwners:{production,reconciliation}`, and an immutable `notificationChallenge:{challenge,issuedAt,repository,operator}`. Generate the challenge once with `createNotificationChallenge()` from the coordinator core; it pins the canonical repository/operator and a fresh 256-bit nonce. Include it before accepting the review hash. The helper validates these pins and carries the exact challenge into `install_epoch`; retries never regenerate it. The actual workflow snapshot must retain the accepted guard path/hash and its review flags. The operator supplies the accepted helper hash explicitly; live commands additionally require the existing source-controlled accepted guard pin and the exact canonical workflow/helper/shared lease paths. Fixture path overrides exist only on imported functions, are restricted to OS temporary directories, and are unavailable from the CLI.

`requiredWriterIds` must include both canonical objectives and every additional discovered legacy writer. Each `writers` entry has `id`, original `ownerThreadId`, and `disabledEvidence:{path,sha256}`. That evidence must record `kind:"fcos_legacy_writer_fence"`, matching writer/owner, `disabled:true`, and the actual writer `sourceSha256`. An existing PID or merely old timestamp is insufficient.

`intentInventories` contains complete directory entry/name/hash lists: `[{directory,entries:[{name,sha256}]}]`. Every listed entry requires an original-owner readback classification in either `uncertainIntents` or `resolvedIntents`, each with `{operationId,ownerThreadId,evidence:{path,sha256},ownerReadback:{path,sha256}}`. Owner readback binds `kind:"fcos_legacy_owner_readback"`, exact operation/owner/intent hash and `outcome:"applied"|"not_applied"|"unknown"`. Unknown outcomes remain explicit and are imported without expiry. The helper rechecks source, evidence and complete directory entries while holding the canonical OS mutex; a changed/new intent refuses fencing.


Mixed producer journals may instead use `intentInventories` entries with `kind:"fcos_legacy_producer_tree_inventory_v1"`, `directory`, current `writerId`, `classification:{path,sha256}`, and complete recursive `entries`. `snapshotLegacyJournalTree(directory)` reads the actual original tree without writing or classifying it. It returns every owned regular file as `{name,type:"file",sha256}` and every directory, including empty ones, as `{name,type:"directory"}`. Names are relative original paths with `/` separators; absolute paths, dot segments, symbolic/hard links, nonregular files and group/world-writable directories refuse. No subtree, cache, Git object or unexpected file is ignored. Do not copy or flatten a producer journal to make it fit.

Assign each file exactly one role: `intent` for an original operation intent; `journal` for a submission/attempt/outcome member of that same operation; or `companion` for an explicitly reviewed non-submission file. A journal adds `intentName`, `intentSha256`, and `producerSourceSha256`, linking to an `intent` file in the same tree. The external-original alternative below supports native journals appended to a different physical producer tree. A companion adds `category` (`source`, `admission`, `receipt`, `metadata`, or `build_cache`) and `producerSourceSha256`. These are exact per-file assignments, never filename globs or subtree exclusions. Known durable intent/attempt/uncertain filenames and recognizable submission envelopes cannot be companions even when a root classification says otherwise. Unknown files require source review and exact classification; the helper does not infer producer semantics from a receipt or filename alone.

The referenced classification must record `kind:"fcos_root_accepted_legacy_producer_inventory_v1"`, `accepted:true`, `reviewerId:"/root"`, original `reviewedAt`, exact `directory`/`writerId`, `writerSourceSha256` matching that writer's fence evidence, and `producerSources:[{path,sha256}]`. Every companion/journal's source hash must belong to those checked original producer sources. It must bind `entriesSha256:legacyProducerInventoryEntriesSha256(entries)`, `completeSubmissionCoverageReviewed:true`, `providerOutcomesInferred:false`, and `providerAuthorityGranted:false`. The operator must actually review the admitted producer callbacks and their complete original-path output assignments before accepting this data. Keep the classification and final cutover review outside all inventoried trees so their own hashes do not create circular evidence. This helper authenticates bytes, not the claimed root identity or provider outcome.

When an original guarded intent is physically under `cycle-cleanup` while its native attempt/acknowledgment is under `setup` or `host-deployment`, classify the journal with `producerSourceSha256` and exactly this alternative to `intentName`/`intentSha256`:

```json
{
  "externalOriginalIntent": {
    "path": "/absolute/original/cycle-cleanup/cleanup.prepared.intent.json",
    "sha256": "<original-byte-sha256>",
    "lease": {
      "epoch": "<original-epoch>",
      "objective": "<original-objective>",
      "ownerThreadId": "<original-owner>",
      "operationId": "<original-operation>",
      "bindingSha256": "<original-binding-sha256>",
      "leaseId": "<original-lease-id>"
    }
  }
}
```

The absolute path must be canonical and outside the journal's tree. The regular, owned, single-link, nonsymlink original must itself be an `intent` entry in exactly one **separately registered, complete, root-accepted producer tree inventory in the same review**, with the same `writerId`. An arbitrary external file or a legacy flat inventory cannot supply this binding. Both physical trees retain all files and empty directories; duplicate or overlapping physical claims refuse. Do not copy, flatten, move, or relabel originals, and do not inventory an active parent tree merely to join their paths.

The six `lease` fields above are the actual existing guarded original's `lease` identity, not new authority assertions. The journal entry digest binds its original path, byte hash and complete tuple; its root classification must explicitly review this exact assignment against the checked producer source. The helper compares the tuple to the original guarded intent, and every tuple field actually exposed by the journal must agree. An opaque native attempt does not establish its own identity: only the separately root-reviewed assignment to the registered original supplies that provenance. Both the final `uncertainIntents`/`resolvedIntents` entry and its existing `fcos_legacy_owner_readback` must carry these same six fields at top level, plus the usual exact intent hash, accepted readback outcome and complete `journalEvidence`. Missing/extra external-reference fields, a simultaneous local reference, unregistered originals, changed bytes, conflicting ownership/operation/binding, or missing root acceptance refuse. Multiple distinct journal states may legitimately bind the one original; duplicate original intent classifications refuse. This alternative does not infer a provider outcome from the original's prepared state or a native receipt, and does not replace independent acceptance or actual owner readback.

For each original intent with journal members, both its existing `uncertainIntents`/`resolvedIntents` entry and its `fcos_legacy_owner_readback` must additionally carry exactly all `journalEvidence:[{path,sha256}]` at their original absolute paths. The helper checks every exposed member operation/owner identity, while preserving the original intent and readback hashes. Prepared/submitting/uncertain files from one operation therefore import one original uncertainty, without invented phase operation IDs. Distinct unknown operations cannot share an operation ID. Missing members, contradictory owners, changed companions, new nested files, and changed/removed empty directories all refuse. The Python fence rechecks the complete tree, all source/classification/readback references and the review itself while holding the same canonical mutex. No companion or journal classification resolves an unknown, disables a writer, authorizes replay, or activates an epoch.

These are hash-authenticated records, not proof of a human's identity or provider provenance. The operator independently verifies stopped writers and actual original-owner GET-only readback before accepting the exact review hash. An existing canonical lease must be resolved only by its actual original owner under the old reviewed rules before fencing can proceed. Do not delete it to make setup pass.

After successful fence readback, `rpc-plan <review-file> <review-byte-sha256> <accepted-helper-sha256> <fence-byte-sha256>` verifies the same sentinel and emits only parameterized `install_epoch` SQL and arguments. It does not connect to a database or call a provider. The operator executes that reviewed plan through a separately verified privileged Supabase connection. It enables qualification only. Final activation additionally requires the actual iPhone-delivery receipt described below. Imported unknowns block qualification/new writes until definitive original-owner readback is recorded through the privileged reconciliation path. See the [coordinator runbook](hosted-release-coordinator.md) for same-epoch hosted qualification and activation. No local fixture substitutes for hosted qualification.

### Administrative qualification handoff

The permanent sentinel cannot be used as an old write lease. Stage the exact
public release setup, digest and coordinator qualification policy under the old
coordinator **before** final quiescence, with the qualification flag `false`.
Complete their original journals and include them in the fenced inventory.
After actual `install_epoch` readback, the privileged operator may use the
one-time `20261020080001_hosted_cutover_bootstrap.sql` handoff. It reserves a
dedicated bootstrap reference on the same singleton control row; it never
fabricates a release registration or GitHub principal. Its private append-only
journal is executable only by `postgres`, not runtime/API users.

The accepted public proof pins the installed epoch, sentinel/inventory hashes,
current Features owner, canonical repository/operator, immutable `64aa` controller,
`12bee` protected caller, `2ef733d1` candidate, exact setup/plan, both independently
reviewed original containment proofs, and exactly two ordered requests: update
`FCOS_HOSTED_QUALIFICATION_ADMITTED` to `true`, then dispatch the registered
`authenticated-release.yml` on that protected ref with qualification-only inputs.
No credential, environment setup, Production, financial or maintenance action is
available. All other setup metadata is already installed and freshly checked.

`node scripts/hosted-cutover-bootstrap.mjs <admit|intent|record|snapshot|finish>
<public-proof.json> [<action-or-evidence.json>]` emits exact parameterized SQL for
the existing target-locked privileged connector. The operator library supplies
the same fixed request sequence with explicit verified admin and native GitHub
transports; it does not discover, accept or store another admin credential.
Commit each intent before the single corresponding native request. An existing
intent is readback-only. Unknown responses keep the bootstrap lock; authenticate
owner readback and append it through the same privileged journal. A missing run
from an eventually consistent list is not proof of no dispatch. There is no
expiry, resubmission or second bootstrap in the same epoch. Only completion of
both original requests releases the bootstrap reference.

The configured server returns the existing definitive pre-storage `429
COORDINATION_METADATA_PENDING` envelope only for the exact reviewed tuple while
this handoff is held. It rechecks after a definitive SQL lock race as well. The
unchanged admitted client waits at most 180 seconds; lost responses are never
retried. After actual registration, the same bounded wait applies while the
**exact two pre-reviewed** containment admissions are still missing. No metadata
provider reads are charged while waiting. Privileged root admission remains a
separate actual action; the server cannot grant it. Foreign, changed, revoked
or third-unknown evidence refuses instead of waiting. Consumed operations retain
their original readback path. Wait exhaustion requires inspection/resumption of
the unchanged manifest, not a new epoch or repeated provider submission. This
initial bridge cannot dispatch a second run: a later definitive failure may need
a separately root-admitted recovery dispatch within the existing authorized
nonfinancial task. It does not introduce another human approval requirement.

Install/read back this migration before deploying the configured coordinator
server. Its image must include both canonical connection configuration and
`config/legacyReleaseContainment.js`. Keep the existing main-source admission
where required; add the actual normal `64aa` caller tuple separately. Qualification
policy stays restricted to its exact source/setup and supplies no Production
approval. The two original imported outcomes remain unknown throughout.

The opt-in `createFinancialCoordinationBridge` preserves the existing financial owner, business scope hash, approval fingerprint, request fingerprint, and legacy business-lock scope/fingerprint. It requires the existing engine's fresh authority and lock callbacks before remote `begin`, and uses the same durable coordinator journal/operation ID as release owners. It has no submit, messaging or dispatch method. Its return values explicitly grant coordination only and no provider/mission authority. Original GET-only `recover` remains possible after a runner restart or approval outage; it cannot submit an operation. Existing financial approval, quota, protected amounts/lines/allocations, settlement checks, locks and final engine rechecks remain mandatory. This module does not activate the financial mission or message its owner.

Local verification: `node --test tests/hosted-release-cutover.test.js tests/hosted-release-financial-coordination.test.js`. Tests use temporary files and simulated financial callbacks; they never alter the live canonical lease or financial records.

## One-time iPhone delivery prerequisite

Keep the service in qualification mode until the canonical operator has actually received the setup notification on the iPhone and supplied a direct human reply confirming the exact installed challenge. Record `challenge`, canonical `repository` and `operator`, `device:"iphone"`, boolean `confirmedByHuman:true`, and the actual original ISO `receivedAt` in a UTF-8 JSON receipt. Retain the authenticated human reply source/reference with the reviewed activation packet. The administrator must inspect that source directly; an agent-authored assertion, notification API success, GitHub inbox read, or a receipt hash does not prove human delivery.

After independently reviewing the actual reply, call `createNotificationDeliveryProof({receiptJson,challenge})` from `supabase/functions/release-coordinator/core.mjs` on the exact receipt text and installed challenge. It validates identity, nonce and timestamp and returns `{receiptJson,receiptSha256}` without adding or refreshing timestamps. It is an integrity helper and grants no authority. Add this object as `notificationDelivery` to the existing privileged `activate(epoch,proof)` packet. SQL recomputes SHA-256 over those exact UTF-8 bytes and verifies the pinned challenge/repository/operator, iPhone device, strict boolean human confirmation, and receipt time after challenge issuance and no more than 30 seconds in the future. The challenge cannot be reused for another epoch.

Only the existing reviewed database migration operator may execute activation. The normal HTTP action list has no activation or receipt-install action; runtime evidence cannot satisfy this prerequisite. Activation stores the original receipt and digest immutably in `activations.proof`, then returns `notificationReceiptSha256`. Missing actual confirmation leaves the Production/financial path inactive. This one-time prerequisite adds no routine release review and grants no new financial authority.

### Exact release-only containment of historical control-plane effects

The optional admitted setup/manifest `legacyReleaseContainment` identifies only the original B53 Preview tenant-row submission and b241 resume-environment policy submission. Their provider outcomes remain **unknown**, their intents remain consumed, and the original import/resolution history is unchanged. This mechanism cannot admit financial or authentication-maintenance work, clear a current operation lock, or permit epoch rollover.

A migration administrator may append a containment record only for an exact registered manifest, epoch, admitted controller/setup and independently reviewed effect proof. Revocation appends a separate record. The runtime cannot admit, revoke or modify these records. An unclassified third unknown, changed binding, missing proof or revocation blocks new writes. Existing consumed operations retain owner readback even when a new-write boundary fails.

B53's serialized value/body hash is unavailable. Its reviewed effect envelope therefore covers **any provider-accepted value** for the exact original plain Microsoft tenant key, Preview target and historical branch; it does not assert a recovered value. Before candidate code, the pinned deployment adapter must require a clean physical detached checkout, the admitted npm-first install/build entry, complete project/applicable shared configuration inventory with no startup/system identity overrides, and automatic provider system-variable exposure. The actual pinned CLI sends the generated manifest-bound Node guard only in `build.env`. Missing/wrong provider branch or commit must stop Node before npm lifecycle scripts. A metadatum or candidate-printed success line alone is not acceptance.

Before privileged B53 containment admission, obtain actual native Vercel build logs demonstrating the guard's exact public manifest/ref/SHA marker before candidate lifecycle output, and a READY, source/configuration-bound, non-prebuilt deployment with the expected target and no custom environment. This initial proof uses the still-current serialized local coordinator while the hosted coordinator remains inactive. Do not run two coordinators or treat a local fixture as this provider proof. A lost submission remains readback-only.

For b241, the trusted credential-free coordinator freshly reads GitHub's current resume and final Production environment protections at each new contained claim, using its existing read-only metadata credential and shared call limiter. Resume must remain protected-branch-only without a reviewer; the separate final Production reviewer remains mandatory. The caller cannot supply the server boundary proof. Activation still requires the actual hosted qualification, all writer fencing/admissions and the original iPhone delivery challenge; no containment record substitutes these gates.
