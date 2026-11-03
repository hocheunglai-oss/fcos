---
name: fcos-fcuno-contract
description: Verify or repair FCOS–FCUNO login, identity synchronization, entitlement, revocation and contract compatibility. Use for federation changes; not general FCOS financial reconciliation.
---

# FCOS–FCUNO contract

Work in the selected FCOS checkout. Read its AGENTS.md, then obtain provider identities and the immutable contract pin from `config/fcosConnections.js`. Distinguish this checkout from canonical dirty work, remote main, the proposed release and deployed source. Preserve unrelated work.

## Verify the relevant boundary

- Run `npm run verify:fcuno-contract`. For an already verified immutable download, set `FCOS_FCUNO_CONTRACT_DIRECTORY` to its directory. Record the original provider commit and digest; a matching schema does not establish semantic compatibility or deployed provider version.
- Trace `api/_fcunoIdentityFederation.js` and its authenticated callers. A verified token, an associated identity, current authentication method and current FCOS authorization are different facts. Never use editable user metadata or a refreshed access-token issue time as original sign-in evidence.
- Run the affected cases in `tests/fcunoIdentityFederation.test.js`, `tests/fcunoIdentitySchema.test.js`, `tests/fcunoContractPin.test.js`, `tests/authSessionLifecycle.test.js`, `tests/authRuntimePolicy.test.js` and `tests/fcunoBuildEnvironment.test.js`. Select focused tests during editing; the release check manifest governs final acceptance.
- Cover an old session refreshed after revocation, genuine new FCUNO sign-in, a password session on a linked account, absent or malformed session evidence, explicitly permitted legacy/break-glass access, and restricted CI access. Preserve fail-closed server enforcement.
- Exercise identical signed-event recovery after a partial projection failure, concurrent/stale events and conflicting same-revision payloads. Keep FCUNO identity/entitlement separate from local FCOS activation, roles and financial authority; new profiles remain deny-by-default.

Use current Supabase documentation/skill for session semantics and the FCUNO producer at the pinned source for custom-provider claims. If trusted current-session evidence is unavailable, report the exact proof gap rather than treating account linkage as authentication. Local fixtures must say which real authentication checks they substitute.

## Deliver

Report exact consumer/provider sources, schema result, semantic regression results and unresolved live checks. For repairs, keep related source and regression tests together, inspect callers, and perform the applicable security review. Do not rewrite the frozen compatibility candidate or reuse old proofs for changed source. This skill grants no credential, provider, database or financial authority.
