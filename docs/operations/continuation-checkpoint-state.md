# Current continuation state

Use `writeAuthoritativeContinuation` from `scripts/lib/hosted-release/continuation-checkpoint.mjs` for the operator's saved continuation. Supply the expected hash of the previous file and references to the actual evidence for the new phase. This utility makes no provider requests and grants no operation or release authority.

The writer updates the top-level and active `status`, `next`, and capture time together. Earlier aliases remain in history. Consumption can only increase; conflicting older count fields cannot reduce a consumed allowance. Unanswered questions cannot silently disappear or be replaced. Existing reply and approval references remain immutable and answered decisions are retained when a new decision replaces them.

All cooperating writers must use the same exclusive local lock. A busy or abandoned lock is a refusal, not permission to take over. Inspect the original owner's actual outcome before separately authorized recovery. Do not remove another writer's lock or reset operation markers. Evidence hashes and the expected previous file hash must still match before replacement.

This checkpoint is navigation and status evidence. It never substitutes for authenticated actor checks, current quotas, immutable source admission, a journaled operation, live verification, or an exact required human decision.
