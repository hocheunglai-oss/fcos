# Financial preview persistence

Evidence-only full checks (`recordExactMatches=false`) publish the run, every document row, requested payment snapshot and completion audit in one transaction. Identical complete evidence can reuse an untouched ready review, preserving its original IDs, snapshot times and provenance. Every check still performs its normal provider reads and classifications before persistence; this is storage reuse, not a provider cache.

The separate `recordExactMatches=true` path retains its existing document/payment linking and claim-resolution order, with the building-to-ready publication guard. Link-first checks require `recordExactMatches=false`; a saved check does not grant category approval. Automatic standing product-mapping policy writes retain their existing audits.

## Bounded link-first capture and publication

Complete provider evidence is partitioned into immutable JSON parts of at most 256 KiB. A closed descriptor manifest preserves object keys, array order and every value. The database validates each part's digest and credential-key restrictions, exact reference coverage, required source shape and tenant. The server reconstructs and verifies the full canonical evidence hash before use. Captured evidence expires after 15 minutes; a published capture remains readable only through its exact completed run and current scoped access.

The financial preview keeps an exact capture reference rather than another inventory copy. Its document rows upload into service-only staging in bounded batches. Independent database hashes bind the initial run and each ordered row; final publication requires every expected row, inserts the complete run/items and audit atomically, and returns saved identities. Partial staging never appears as an approvable financial run. Identical request recovery preserves later approval/execution state; changed evidence fails closed. v2 does not reuse a different request UUID.

Full payment evidence stays in the bounded run summary. Current bounds are 8 MiB per run, 256 KiB per document, 512 KiB per database batch and 100 MiB total staged evidence. Exceeding a bound is an explicit error; no evidence is silently dropped. These storage operations consume no Xero calls and confer no posting or linking authority.

## Identity and recovery

The server identity covers the complete persisted document/payment review and fingerprints of the complete source, provider, schema, mapping and payment-claim inputs. Posting mode, currency, cutoff, tenant, Salesforce org, reconciliation version, disputes, warnings, files and payment evidence remain material. Only explicitly listed generated IDs, capture times, request actor metadata and quota readings are excluded. Array order remains material; harmless inventory reordering can conservatively produce another review.

The service-only `persist_xero_financial_preview_v1` RPC independently hashes the typed payload, locks the request UUID and evidence identity, and rechecks stored rows before reuse. It accepts only complete, unselected, unattempted initial previews. Authorised, processing, failed, completed and cancelled generations are never reset or reused by a new request. Reused checks add one small audit receipt; they do not add another full document copy.

A unique audit receipt binds each request UUID to its published or reused run. One retry after an uncertain transport response uses the exact same UUID and payload. If Finance has since approved that run, the response returns its actual state and saved row IDs. It cannot reset approval or replay accounting writes. A failed transaction leaves no partially published snapshot, and there is no non-atomic persistence fallback.

Documents-only checks now have a restorable snapshot with `payments:null`. The cheap change probe compares payment scope, exact-match scope and current tenant before returning unchanged, so such a snapshot cannot suppress a subsequent Portal payment/linking check. Legacy unknown scopes require a full refresh.

## Verification and rollout

- Hash and service tests cover material changes, scope switching, stored identity/provenance, bounded response-loss retries and fail-closed errors.
- SQL tests cover all-or-nothing failures, receipt uniqueness, permissions, incomplete or altered rows, historical-state preservation and concurrent requests/approval.
- The optional localhost PostgreSQL suite is mandatory in the quality workflow. It uses an isolated disposable database and does not access provider records.
- A synthetic 2,995-row request of 16,946,917 bytes passed both embedded and real PostgreSQL tests. This establishes SQL behaviour, not hosted PostgREST request limits, production latency or production disk headroom.

Apply the migration only after the database capacity incident is resolved and the normal migration review/checks pass. Then verify a representative request through the authenticated server-to-Supabase HTTP path, and run the trusted fresh-login and exact-commit release checks before deployment. An unavailable RPC must remain an error, not a trigger to recreate duplicate snapshots through the old path.

This migration adds a function and a partial unique audit index. It contains no retention job, historical deletion, backfill, financial approval, provider posting or quota override. Existing storage recovery is a separate operation requiring its own verified backup and capacity plan.
