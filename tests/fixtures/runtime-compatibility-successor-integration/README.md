# Portable successor source test fixture

This versioned fixture contains the unchanged public V2 manifest and 272-object
non-thin pack. It deliberately contains no copied checkout source. Manifest
`checkout/` members are authenticated against actual repository files through
`tests/helpers/runtimeCompatibilitySuccessorPortable.mjs`, and the separately
pinned source-bindings manifest covers all 18 accepted aggregate paths and the
unchanged consumers, observation interpreter, lock and policy used by the tests.
The original 265-object fixture remains unchanged.

`npm test` discovers both new `.test.js` files. The integration wrapper launches
only the exact hermetic `.mjs` child with Node's VM flag and explicit TAP reporter,
using `process.execPath`, a repository-relative target, an explicit working
directory and a minimal environment. It rejects child failure and requires all
20 inner checks to pass. The wrapper is one discovery check, distinct from those
20 behavioral checks. Physical tests require the existing locked `ignore` package
used by the actual provenance module; the hermetic child needs no node_modules.
No package.json or suite-wide Node flag change is proposed.

The 11 physical cases operate on real local synthetic Git repositories. They
exercise actual unchanged repository provenance source, including staged/hidden
bytes, mode and symlink integrity. They do not prove a real candidate's clean
checkout or release eligibility. The 20 hermetic cases port 12 negative cases and
add eight portable source/caller checks. They authenticate real source, review
bytes and all 272 packed objects, while clean provenance, canonical root and
origin are explicit unit fixtures. Provider, fetch, browser, credential and
filesystem-write authority paths throw tripwires. Candidate application JavaScript
is read as immutable Git objects and is never evaluated by the source adapter.

Corrupt/truncated pack rejection is native Git fixture consumption only. This
fixture does not implement or claim an application carrier-import boundary.
Source preparation remains `ready:false`, `existingUi:false`, with live, build,
credential, signer, admission and Production authority deferred. All 15 actual
live module checks, new private human flow, disposable DEVEE acceptance, stronger
compatibility rollout, observed Production successor and final 2f4 ordering remain
mandatory. Historical old33 and V2 old15 results are separate immutable evidence;
these portable tests do not repeat those suites or upgrade their readiness.

The pins intentionally fail before test bodies when relevant source changes.
A future source change needs an explicit reviewed binding update and affected
verification rather than silently running tests against historical copies.

## Current consumer binding revision

CI repair adds `fixture-manifest-v3.json` and `source-bindings-v2.json`, pinned
to the actual public implementation bytes at `e29f52b418e76ce615bda3c8fde34dc61c551bc4`.
The original manifests, source bindings and272-object V2 pack remain unchanged.
The new binding authenticates all80 used source/control/review paths. Current
consumer assertions distinguish source preparation from opaque admission and
retain exact protected refusal codes; denied environment reads return no value.

`control-objects-v1.pack` is a separately pinned non-thin three-blob supplement
for frozen04ee `config/fcosCiIdentity.js`, `vercel.json` and `package.json`. Live
unit fixtures start with an empty disposable object store, authenticate all272
original objects, then exactly three additional blobs and all13 raw candidate
controls. One separately bound current public signer file has exactly the raw
frozen04ee blob OID and body hash; importing its existing bytes yields276 objects.
They never use the host's object alternates or fetch candidate history.
These offline repositories and fixture review data confer no protected or live
authority. No production implementation, control, workflow or dependency changes
are part of this CI repair.

The Python ledger CI step adds `source-bindings-v3.json` for the reviewed
quality workflow bytes. The v2 bindings and historical manifests remain
unchanged; the portable helper verifies the retained v2 hash before loading v3.
This fixture update grants no installation or provider authority.

The coordinated routine-release change adds `source-bindings-v4.json` for the
actual current release helpers, workflow and canonical project control carryover.
The helper verifies the untouched v2 and v3 history before reading v4. The base
commit fields identify the preparation base; the individual source hashes bind
the exact new working bytes. All frozen source objects, packed carriers, fixture
manifests, first-rollout observations and runtime assertions remain unchanged.
This update is an offline current-source test binding, not live admission.

The default-disabled coordinated executor adds `source-bindings-v5.json`. It binds
current native action, coordinator, ledger, workflow and revision3 connector approval
controls. The helper authenticates the unchanged v2/v3/v4 chain first. Historical
objects, source manifests, first-rollout refusals and final2f4 ordering are retained.

`fixture-manifest-v4.json` updates only the current checkout member bindings and
base metadata; original object inventory, observation bindings, packed bytes and
non-checkout members remain identical. The helper authenticates the old v3 manifest
hash separately and verifies the v4-to-v3 history before consuming current source.
