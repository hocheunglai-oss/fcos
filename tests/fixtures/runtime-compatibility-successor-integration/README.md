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
