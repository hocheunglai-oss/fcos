# FCOS application workflow improvements

User-authorized scope: implement every recommendation from the application review, preserving Production 2.0.214 (`5bc745cbb18a6d559122aac1cdb67d31e7fda21b`). Work proceeds in three increments, with shared foundations used by the affected workspaces. Salesforce remains authoritative for its business records. Financial posting and external sending retain explicit review and existing permission checks.

## Acceptance and implementation ledger

### 1. Consistency and reliability

- [x] Restore user-owned edits after navigation, errors and reloads; distinguish local draft, saving, authoritative save and failure; never restore another user's draft or silently apply an old draft over changed source data.
- [x] Required inputs and conditional requirements are explicit; validation summary links to fields; blocked actions explain permission, ownership, dependency and missing information.
- [x] Material amendments show old/new values and renew only affected reviews; existing immutable document and financial controls remain enforced server-side.
- [x] Permission/assignment checks run before editing and at save; tests cover trader, Finance, GM, administrator and reassignment.
- [x] System incidents have actionable severity, correlated presentation and scoped verified recovery; uncertain financial/email outcomes are not treated as successful by a connectivity check.
- [x] Data states distinguish missing, unavailable, not loaded and not applicable, with source and freshness.

### 2. Connected workflows

- [x] Permanent permission-scoped STEM workspace connects products, counterparties, charges, documents, payments, disputes and activity; direct URLs and navigation retain STEM context.
- [x] Search includes permitted STEMs, vessels, invoice/payment/dispute references as well as Accounts/GROUPs/workspaces; bounded server queries enforce source access.
- [x] My Commitments is an optional operational home with role-aware priorities, next action, blocker, owner, due date and eligible quick actions.
- [x] Collections, disputes, Xero, brokers and compensation use consistent action/waiting/completed/all presentation with existing domain state preserved.
- [x] Document preview-first controls show available authoritative status/version/currency/STEM metadata; downloads remain in the preview.
- [x] Collections/Xero expose linked obligations, allocations and evidence; disputes retain agreement and settlement context; terms/contracts show changes, audience and effective date.
- [x] Markets/Hedge Desk connect sourced observations and exposure; Cashflow explains confidence and changed assumptions; Email Router links business context; operational tasks avoid duplicate work items.

### 3. Speed and automation

- [x] Preserve user-owned filters, columns, scroll and selections, with safe cleanup and explicit reset.
- [x] Eligible bulk work has one review, individual outcomes, partial recovery and no replay of completed/uncertain external effects.
- [x] Expensive reads use bounded reusable snapshots/incremental refresh where supported, with fresh server validation before consequential writes.
- [x] Extract cohesive domains from the API dispatcher without changing authorization, handler names, business calculations or side-effect ordering.
- [x] Measure completion/friction signals without storing sensitive form values; expose useful aggregates to authorized administrators.

## Verification and rollout

- [x] Focused unit/integration checks for new logic, permission boundaries, draft isolation/conflicts, API pagination and partial outcomes.
- [x] Desktop/mobile fixtures for forms, validation links, navigation recovery, STEM context, search and bulk review.
- [ ] Existing test suite, lint, typecheck, compatibility, Graph-only, performance, migrations and production build.
- [ ] Exact Git-linked Preview; trusted protected browser workflow and immutable evidence, all required checks, current Production baseline reconciliation.
- [ ] Live read-only verification, retained business and audit records, task browser/process cleanup.

No customer emails or production financial transactions are sent during verification. Routine release checks run without recurring human environment approval under the current repository policy.

## Implementation evidence and boundaries

- Draft recovery is shared by Variable Charges, dispute preparation, Special Terms revisions (including legacy hydration), Master Contracts, compensation claims and new operational tasks. Owner-scoped storage flushes pending edits before navigation. A three-way comparison preserves independent edits and requires review when source fields changed. Server permissions, assignment checks, confirmation fingerprints and immutable document controls remain authoritative.
- Variable-charge confirmations now supply a standard audit note only when every current row is unchanged and no writes are requested. Amendments still require an explicit reason. Existing Xero per-item batch results, safe partial recovery and dispute party agreement/settlement controls are retained; restored selections exclude changed, completed and uncertain rows.
- The permanent STEM page reuses the financial detail and document components with contextual links and a permission-scoped activity feed. Global and Email Router reference search are bounded and scope every related result through Salesforce. Salesforce schema inspection and actual bounded reads verified the query fields; two invalid legacy broker fields were removed. Failed core financial reads now produce an unavailable state instead of a misleading empty result.
- My Commitments can be selected as the operational home. Existing role-aware work queues and eligible actions are retained, with responsibility and blocker detail where authoritative data is present. Read-only Broker Register filters are preserved rather than inventing task states for report rows. Compensation adds action/completed/data-quality views.
- Document controls preview first and show available source metadata, with authenticated download inside the preview. Special Terms remain PDF-only and retain the approved typography. Contract and term revision boundaries remain unchanged.
- Page filters, existing column preferences, safe Xero selections and workspace scroll survive navigation. Long-form methodology content is generated from its single editable source and fetched on demand; failure has a retry action. Existing navigation snapshots and pre-write freshness checks remain in place.
- Cashflow explains historical support and changed assumptions without changing its financial model. Markets links to Hedge Desk exposure. Email reference search never files or attaches messages automatically. Operational task creation uses atomic request identities, including template creation, to avoid duplicate retries.
- System recovery is extracted from the dispatcher. Verified connectivity cannot resolve an uncertain send; recurring incidents cannot be hidden by an older resolution state. Administrators see aggregate workflow outcome/timing statistics without form contents, actor identifiers or financial records.
- Migration `20260916223258_app_workflow_reliability.sql` adds service-only request identities and aggregate metrics. Verified on FCOS: RLS enabled; browser roles denied; service role granted; functions use invoker security and an empty search path. No business transactions were created by verification.

Release proofs are retained under ignored `outputs/app-workflow/`. Local fixture actions are stubbed; they do not establish provider posting or email-delivery evidence. The governed authenticated Preview account remains limited to Dashboard/Markets. Additional modules are covered by local interaction tests, server permission tests and read-only provider schema/query checks. No Salesforce metadata changes are part of this release.
