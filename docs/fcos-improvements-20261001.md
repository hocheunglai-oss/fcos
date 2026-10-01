# FCOS improvement programme

Authorized on 1 October 2026: implement all eight recommended improvements.
Development authority covers code, focused verification, draft PRs and verified
Preview work. Production promotion, live migrations, financial application,
external communications and credential replacement retain their exact approvals.
Desktop is the UI target; preserve the suspended mobile implementation.

## Source and integration

- Production's public version manifest was read on 1 October: v2.0.288,
  commit `f3472492ff4d0b0c70248a3c8e5c0012981a94b3`. This is the initial base.
- The local v2.0.289 candidate `05e87742137476bf5a92f9e8c0c68ebc53decef8`
  contains subsequent fixes. Preserve and reconcile it before preparing a release;
  do not treat it as already deployed or overwrite another task's changes.
- Worktree: `.fcos-cli/worktrees/overall-improvements-20261001`;
  branch `codex/overall-improvements-20261001`. Primary checkout remains untouched.
- GitHub CLI is `vincelessxai`, so FCOS remote access uses the independently
  verified `hocheunglai-oss` connector. Repository and admin/push permissions were
  verified. Do not change machine-wide credentials.

## Work packages and acceptance

| Package | Status | Deliverable and acceptance |
| --- | --- | --- |
| 1. Business policies | Implemented; release verification pending | Shared immutable policy definitions; protect inclusive Sep 1 Nom B cutoff, actual-before-expected dates, file formats and decoded limit. Preserve invoice exclusions, document-based filing evidence, ownership and exact-operation recovery. Extend scenario coverage where other domains lack it, without replacing their financial controls. |
| 2. Actionable commitments | Implemented; release verification pending | Review existing actionable rows first. Add precise next action, blocker, responsible person and deadlines where source evidence supports them. Preserve category filters, sign-in links and inline Nom B filing; no new Dashboard Nom B button or separate page. |
| 3. Data completeness | Implemented; release verification pending | Surface missing trader, delivery, document and counterparty evidence at the appropriate existing workflow stage, with authorized correction links. Unknown values remain unknown; no automatic record repair or invented deadlines. |
| 4. Speed and modularity | Implemented; release verification pending | Measure representative requests and frontend/server budgets, including provider/database calls. Extract bounded services from the dispatcher and optimize duplicate reads or loading only with preserved scope, gates, locks, freshness and cancellation. Compare before/after correctness and throughput. |
| 5. Operational recovery | Implemented; release verification pending | Extend existing System Health incidents with affected-record access, owner, impact, last success and recovery guidance. Add actionable scan-lag/failure thresholds. Definite transient retries keep backoff; uncertain external outcomes require readback or review. |
| 6. Management visibility | Implemented; release verification pending | Build on existing permission-scoped reports and workflow metrics for overdue work, documents, readiness, collections, held reconciliation and verified margin. Keep denominators, dates, currencies, freshness and incomplete evidence explicit; drill through to authorized records. |
| 7. Release outcomes | Implemented; release verification pending | Verify deployed version, update visibility and actual workflow completion together. Retain immutable exact-source evidence, migrations, compatibility, performance and authenticated desktop checks. Mark released only after authorized promotion and fresh readback. |
| 8. Trader automation | Deferred by user until OpenAI key is created | Implement durable intake, completeness checks, supplier matching, quote preparation and follow-up workflow in stages. Persist intent, provenance, cancellation and recovery; keep external sending, commercial commitment and financial actions behind their existing exact approval boundaries. Verify secure OpenAI connection before live model use. |

## First change

`shared/businessPolicies.js` holds the initial Nom B policy. Existing server
exports, pagination revision, accepted formats and decoded size retain their
values. The browser file selector derives accepted extensions from the same
policy. Existing integration tests cover reminders, ownership, upload recovery
and navigation; added scenarios explicitly prevent falling back from an invalid
actual date to a later expected date.

## Continuation

Finish and retain focused policy verification, inspect the diff, then reassess
remaining usage before the next substantial package. Inventory current
commitment row contracts before designing package 2. Keep this document's status
and evidence accurate; planning or fixtures alone do not complete a package.

## Checkpoint before secure key setup

- Existing-key presence check returned false without revealing credential values.
  User explicitly selected Create a key securely on 1 October 2026. Open the
  Platform picker, then handle its widget follow-up and confirm local destination
  before key creation/write. No API-backed trader code has been implemented.
- Nom B policy, navigation, ownership/reminder/upload and commitment suites:
  100 tests passed; focused ESLint and both TypeScript configurations passed.
- Newly added workflow summary (server aggregation and desktop-only cards) has
  not yet been tested. Next check: tests/workflowMetricsSummary.test.js, followed
  by changed-file lint/typecheck. Do not report management package complete.
- API extraction worker /root/api_modularity owns a separate worktree
  `.fcos-cli/worktrees/overall-api-modularity-20261001`; inspect its result and
  integrate only its owned API extraction/module/tests.
- No application commits, remote pushes, draft PR, Preview or Production release,
  Salesforce metadata change, live migration, financial write or customer send.
- Preserve the separate v2.0.289 candidate when assembling the final release.
- Remaining usage last reported 22 percent. Recheck before another substantial
  phase; suspend safely if below the user's 20 percent reserve.

## Non-AI implementation checkpoint

- Shared Nom B cutoff, file limits, accepted formats, displayed cutoff and cursor
  revision now use one immutable policy. Values retain the existing behavior.
- Commitments show saved blockers and explicit assigned owners, use No recorded
  deadline when no deadline was collected, and disclose unavailable/capped
  sources including the combined notification cap.
- Missing Nom B rows identify unavailable buyer, vessel, port or IMO details and
  point to their existing STEM detail view; this does not block eligible filing.
- Nom B API wrappers extracted and integrated. Dispatcher shrank by 29 lines.
- System Health explains safe recovery responsibilities, and an active scan with
  missing/invalid checkpoint warns instead of reporting online.
- Desktop Dashboard adds authorized collection/reconciliation links and a manual
  personal work check with freshness/partial evidence. Margin KPIs and export
  formats remain existing calculations. No Dashboard Nom B action was added.
- Technical workflow summary is Administrator-only, keeps partial totals explicit
  and does not certify external/financial completion.
- Updates show running versus last-checked queue version. Release writing rejects
  histories whose current version is not first. Existing sending controls remain.
- Independent material-risk review found notification-cap omission; corrected and
  tested. No other actionable regression was found in the reviewed areas.
- User subsequently deferred OpenAI key creation and API-backed trader automation.
  Do not create or save a key under the earlier choice while that deferral stands.
- Next: preserve/integrate v2.0.289 candidate, reinstall locked dependencies using
  canonical setup, run exact-source release checks, publish draft PR and verify
  immutable Preview. Production and live writes still require exact approval.

## Candidate assembly and verification

The v2.0.290 candidate includes the complete v2.0.289 source, preserving buyer
charge scope, permission checks, notification filters, response recovery and
cache bounds. The primary checkout's application changes remain untouched.

The complete Node suite passed 4,555 tests with 41 disposable-database skips;
lint, both type checks, compatibility and Graph-only checks passed. Desktop
Management Overview verification confirms manual loading for read-only users,
permission-scoped links, personal/partial counts and retained evidence on error.
The migration gate verified 187 ordered migrations against empty and populated
v2.0.287 fixtures; temporary scenario databases were removed. Live read-only
Supabase verification confirms collaboration_items.blocked_reason is present and
can be selected. No new migration or Salesforce metadata is introduced.

Final hosted build, performance budgets, quality CI and trusted authenticated
Preview evidence are still required. OpenAI key creation and trader automation
remain deferred by the user's latest instruction. Production promotion requires
exact approval after those checks.

## Integration with the newer connection-controls candidate

The final version is 2.0.292. It preserves the complete newer candidate
fa3a735567912437d1ac76abaafd36f8e66df493, including release controls and
truthful Preview reads. Version history retains 2.0.290 and 2.0.291 and gives
these operational improvements a distinct 2.0.292 entry. Only version files
conflicted. New exact-source proofs are required after integration; earlier
checks remain historical evidence. Production authority is unchanged.
