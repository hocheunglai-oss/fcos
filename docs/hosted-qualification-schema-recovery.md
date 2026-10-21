# One finite qualification schema recovery

`20261022000001_qualification_schema_recovery.sql` adds a separate, private
administrative journal for the terminal manifest-preparation failure in run
`39653018028`. It is restricted to epoch 1, recovery
`qualification-schema-recovery-epoch1-39653018028-v1`, original bootstrap
`qualification-bootstrap-epoch1-3527fbf5-v1`, and successor release
`fcos-qualification-64aa338b-2ef733d1-schema-20261022`. There is no new epoch,
unfence, generic retry or permission to create financial/Production operations.

The privileged `postgres` caller is the admission trust boundary. Root and the
distinct `/root/canonical_publication_review` reviewer must actually inspect the
original evidence, terminal failure, schema witnesses and exact recovery bytes.
Their strict review objects bind a canonical subject excluding both reviews.
Hashes and reviewer strings prove integrity bindings; they do not authenticate
reviewers. The operational executor separately pins the byte hashes of the
actual inspected root and independent receipts. Synthetic test reviews never
authorize a live action.

Admission requires the actual immutable original database row and matching
canonical proof hash, completed original native actions and finish, the permanent
sentinel and original inventory, all three unresolved imports, valid exact-7dc
quarantine, and no epoch registration, operation or containment. Historical
bootstrap rows and clocks remain unchanged. Only `setup.firstRuntimeBaseline`
may differ: its schema observation and `nativeEvidence.schema`, baseline byte
integrity and recomputed root acceptance. Every other baseline field and original
clock stays identical. The successor plan changes only its exact release ID and
`migration.expectedSchemaSha256`. Expected schema is
`84ef2811eeefb87f8be4ef5219ab031f37fd3fd424a390e4c80b4afba7f13a4d`.

The owner catalog snapshot prepares the reviewed baseline. It is not the
dedicated hosted observer's qualification proof. The immutable controller's
original first-runtime checks, schema collection query, expected digest
comparison, authentication, human/iPhone gates and Production approval remain
unchanged. A hosted observer mismatch still refuses qualification.

Before consuming admission and every new intent, the private SQL catalog digest
function runs the byte-identical immutable `64aa` `SCHEMA_QUERY` with
`search_path=pg_catalog` and canonical hashing. Schema drift refuses before the
finite reservation or another native write. Consumed intents stay readback-only.
Finish deliberately does not repeat this catalog check after all three known
ACKs; later catalog drift must not strand a completed administrative handoff.

Use `schemaRecoverySql` from
`scripts/lib/hosted-release/qualification-schema-recovery.mjs` through the existing
verified target-locked administrator connection. `admit`, `intent`, `record`,
`snapshot` and `finish` produce parameterized SQL only. Admission holds
`control.recovery_id` until all three fixed requests have known applied outcomes:

1. PATCH `FCOS_ADMITTED_RELEASE_SETUP` to the exact successor public JSON.
2. PATCH `FCOS_ADMITTED_RELEASE_SETUP_SHA256` to its canonical digest.
3. Dispatch the original unchanged protected caller exactly once with the
   successor qualification plan and Xero recovery disabled.

The operator transport verifies the target, original caller, enabled qualification
flag, terminal failed run and exact expected setup pair at each write. Reserve
each intent durably before its single native request; append a known ACK before
the next action. The transport returns a sanitized native JSON projection with
HTTP `status`; only 204 without contradictory refusal/pending/uncertainty or a
nonzero `exitCode` is a known ACK. A thrown, refused, uncertain or absent native
response stops the operator locally. It performs no record, snapshot, cleanup,
retry or other RPC afterward. The already committed intent retains the
reservation. Separately admitted original-owner readback is required before any
later journal operation; absence from a run list cannot establish non-application.
`not_applied` is terminal and cannot be replayed. There is no timeout, takeover,
second recovery or finish on incomplete configuration.

Concrete server policy/deployment/URL handoff remains a separately reviewed,
finite root-owned operational sidecar held under the same reservation. Complete
and read back that sidecar before these three GitHub requests. This journal does
not grant provider authority, create a host, select a destination, alter secrets
or bypass local guarded-provider-write controls. The server's exact successor
setup admission must be installed independently; HTTP/GitHub authentication is
unchanged.

`createQualificationSchemaRecoveryOperator` requires trusted read-only
`verifyConfiguration` and `verifyOwnerReadback` callbacks in addition to its
existing target-locked admin/native transports. Configuration verification runs
before each intent and must actually verify the chosen isolated project,
source/manifest, exact successor policy/setup, ready deployment, `/coordinate`
URL/current public URL and preservation of credentials/default Production.
`validateSchemaRecoveryConfiguration` requires the strict finite receipt shape
and pins those identities. A caller-authored receipt without the verified
callback's actual readbacks is not evidence. Manual SQL execution has the same
operational prerequisite. Explicit owner readback requires a separately admitted
callback receipt binding recovery/action/evidence and its inspected admission
receipt hash; only exact applied readback clears the operator's local stop.

Registration and new claims are blocked while the reservation is held. Only the
exact successor principal/manifest tuple receives the existing bounded metadata
pending response. After finish, an ephemeral admission projection selects the
exact successor setup/plan; it never changes the historical original proof.
The original two containment proofs must then be separately admitted for that
manifest before any qualification claim. Claim admission rechecks all three
UNKNOWN imports and quarantine. Existing consumed operations retain their
original readback behavior after later drift; they gain no follow-on authority.

Focused local verification is
`node --test tests/hosted-qualification-schema-recovery.test.js`. It requires native
PostgreSQL, uses a temporary Unix socket without a TCP listener, and calls no
provider. It covers source-drift rollback, preserved OIDs/ACLs, finite admission,
exact native sequence, partial handoff, uncertain readback, review/type/scope
refusals, private append-only histories and claim containment. Passing it is
local implementation evidence, not live migration or qualification evidence.
The native test first proves the real private catalog function equals the exact
query and JavaScript canonical digest, including real public-catalog drift.
Success-path synthetic journal cases then explicitly replace that dependency
only inside the disposable test database. Production migration bytes, constants
and gate bodies remain unchanged; no runtime fixture hook is present.
