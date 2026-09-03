import { APP_VERSION } from './appVersionMeta.js';

export { APP_VERSION };

export const APP_VERSION_HISTORY = [
  {
    version: '2.0.197',
    releasedAt: '2026-09-03',
    title: 'Include direct FCBS costs in hedge results',
    changes: [
      'Deducts the direct FCBS venue charge from FCBS gross Paper Hedge P&L before proposing the Salesforce SWAPS cost.',
      'Keeps ICE on gross P&L because its broker, exchange, clearing, and settlement charges remain separately billed.',
      'Shows gross P&L, FCBS direct costs, net hedge result, and the resulting Salesforce cost during review before confirmation.',
    ],
  },
  {
    version: '2.0.196',
    releasedAt: '2026-09-03',
    title: 'Route FCBS hedge results correctly',
    changes: [
      'Posts FCBS Physical Trade hedge results to FRATELLI COSULICH BUNKERS (S) PTE LTD while ICE results continue to use Straits Financial Services.',
      'Locks the approved venue supplier identities against stale saved settings and validates the exact live Salesforce Accounts before writing.',
      'Shows current and proposed suppliers during review and corrects an uninvoiced mismatch only after the user confirms the update.',
    ],
  },
  {
    version: '2.0.195',
    releasedAt: '2026-09-03',
    title: 'Correct Port Clearance buyer defaults',
    changes: [
      'Calculates the Buyer Port Clearance Extension as the supplier-reported application count minus the first included application, at HKD 58 per additional application.',
      'Updates the buyer USD total immediately when the Supplier Leg application count changes, using the reviewed company USD/HKD rate.',
      'Stores exact supplier and buyer totals as fixed Salesforce charges to avoid cent rounding drift from per-unit pricing.',
    ],
  },
  {
    version: '2.0.194',
    releasedAt: '2026-09-03',
    title: 'Clarify Physical Trade STEMs and Salesforce units',
    changes: [
      'Shows each Physical Trade\'s full Salesforce STEM Name in a dedicated clickable column that opens the shared STEM detail.',
      'Sets every reviewed SWAPS extra cost to quantity 1 and the Salesforce unit-of-measure value 1 instead of inheriting MT.',
      'Prevents STEM Processing from reading Payment Term before its independent Salesforce record wire is ready.',
    ],
  },
  {
    version: '2.0.193',
    releasedAt: '2026-09-02',
    title: 'Add reviewed Physical Trade hedge results',
    changes: [
      'Adds calculation-only gross Paper Hedge P&L allocations to linked Physical Trades, grouped by venue and displayed as proposed Salesforce STEM costs.',
      'Adds explicit Add, Update, Recreate, Restore, and Adopt review paths while keeping every preview and recalculation read-only.',
      'Detects deleted, cancelled, manually changed, conflicting, and invoiced Salesforce rows through managed external keys and immutable FCOS history.',
      'Moves Salesforce hedge-result review from Paper Hedges to each recipient Physical Trade and preserves legacy allocation evidence for Account Insight.',
    ],
  },
  {
    version: '2.0.192',
    releasedAt: '2026-08-30',
    title: 'Stabilize operational workflows and connections',
    changes: [
      'Adds the Hong Kong Basic Calling Cost bundle and reviewed statutory-charge evidence without automatically overwriting supplier or buyer financial amounts.',
      'Hardens Salesforce-to-Xero contact synchronization, adds bilingual Xero guidance, and keeps every financial synchronization action explicitly gated.',
      'Adds guided workflow manuals, project-local development safeguards, and clearer Variable Charges task handling.',
      'Removes the obsolete Google Fonts connection entry and recognizes the approved live Xero Portal contact-sync state in System Health.',
    ],
  },
  {
    version: '2.0.191',
    releasedAt: '2026-08-29',
    title: 'Improve evidence, search and operational visibility',
    changes: [
      'Adds consistent calculation evidence to Dashboard and Account Credit figures, including authority, exclusions, warnings and evidence time.',
      'Makes Salesforce freshness contextual and searchable, and adds exact Account and GROUP lookup to the global command palette.',
      'Groups repeated system incidents without losing occurrence counts and brings Markets and Xero work into My Work.',
      'Adds governed function contracts and compatibility checks while reducing initial client weight through lazy version-history loading.',
    ],
  },
  {
    version: '2.0.190',
    releasedAt: '2026-08-23',
    title: 'Simplify the Incoming Payments internal report',
    changes: [
      'Replaces the three-step Incoming Payments email wizard with one review-and-send surface matching the payment-reminder workflow.',
      'Loads approved recipients and the live report preview together, then rebuilds current report data immediately before delivery.',
      'Keeps approved recipients read-only during ordinary sends and allows authorized template managers to change them only through an explicit saved revision.',
    ],
  },
  {
    version: '2.0.189',
    releasedAt: '2026-08-21',
    title: 'Add Platts-aligned market intelligence',
    changes: [
      'Adds a Daily Decision Brief, exact contract-month forward curves, source-linked bunker drivers, and company alert controls without trade recommendations.',
      'Replaces shared M1/M2 adjustments with verified outright BM, M1, and M2 observations plus short-lived authorized fallbacks for missing exact contracts.',
      'Keeps settlement MOPS controls and hedge-expiry verification available while the new valuation curve completes its ten-publication-day shadow review.',
      'Backfills structured licensed-report evidence without storing PDF content, report commentary, prompts, or raw AI responses.',
    ],
  },
  {
    version: '2.0.188',
    releasedAt: '2026-08-20',
    title: 'Add delivered-price MOPS analytics',
    changes: [
      'Adds Hong Kong VLSFO, HSFO 380, and LSMGO plus exact Not published gaps for South Korea West.',
      'Adds exact-date premium/discount sparklines, 1W/1M/3M statistics, and synchronized 1W-to-1Y product charts.',
      'Preserves immutable report lineage, quarantines conflicts, and publishes settlement MOPS only from a complete European Marketscan AMFSA00/PPXDK00/POABC00 triple.',
      'Moves long market history behind a lazy authenticated range API and expands System Health with report-sync and MOPS publication outcomes.',
    ],
  },
  {
    version: '2.0.187',
    releasedAt: '2026-08-20',
    title: 'Add delivered bunker market intelligence',
    changes: [
      'Separates Delivered Bunkers, Cargo & Forward, and Trading Signals while preserving the controlled MOPS settlement data path.',
      'Adds Singapore, South Korea, South Korea (West), Zhoushan, and Kaohsiung coverage for VLSFO, HSFO 380, and LSMGO with explicit assessment, posted, unavailable, and stale states.',
      'Maps Kaohsiung MF-380 to HSFO 380 and displays LS180 as the local VLSFO label.',
      'Adds deterministic licensed-report review and service-only storage for structured observations without retaining report files or text.',
    ],
  },
  {
    version: '2.0.186',
    releasedAt: '2026-08-19',
    title: 'Configure Buyer PIC row colours',
    changes: [
      'Adds ordered row-colour rules to Buyer PIC References, with the first exact match determining each desktop row and mobile card tint.',
      'Allows any text, multi-line, checkbox, number, Buyer Trader, or Supplier Trader column to drive a colour condition instead of limiting colours to Team.',
      'Saves colour rules independently with live Account revalidation, revision conflict checks, idempotency, and service-only storage.',
    ],
  },
  {
    version: '2.0.185',
    releasedAt: '2026-08-18',
    title: 'Pin Salesforce Production authentication profile',
    changes: [
      'Records Vincent as the non-secret Salesforce Production browser authentication profile while retaining Otto for FCOS, DEVEE, and QAT.',
      'Requires an exact Salesforce environment and browser-profile acknowledgement before browser authentication guidance is shown.',
      'Keeps vincexai isolated to the shared Salesforce GitHub repository and never records browser credential or passkey material.',
    ],
  },
  {
    version: '2.0.184',
    releasedAt: '2026-08-18',
    title: 'Clarify Supplier Invoice evidence',
    changes: [
      'Labels issued Supplier Statement evidence as a Supplier Invoice number instead of displaying an unexplained Salesforce value.',
      'Renames the desktop evidence column to Supplier invoice / estimate and gives mobile evidence the same explicit wording.',
    ],
  },
  {
    version: '2.0.183',
    releasedAt: '2026-08-18',
    title: 'Preserve Account results around Insight',
    changes: [
      'Opens Account Insight over the live Dashboard so closing it preserves the Account page, exposure results, filters, scroll position, and keyboard focus without another directory request.',
      'Places the Both, Buyer, and Supplier selector inside every USD credit forecast and keeps unavailable directions visible but disabled.',
      'Removes repeated exposure explanations from Account results while retaining the combined Credit Statement risk warning.',
    ],
  },
  {
    version: '2.0.182',
    releasedAt: '2026-08-18',
    title: 'Correct combined buyer exposure currency',
    changes: [
      'Keeps buyer receivable exposure in Salesforce corporate USD when single-currency STEM records do not expose CurrencyIsoCode.',
      'Makes the combined Buyer and Supplier statement agree with the authoritative buyer statement instead of defaulting the buyer side to zero.',
    ],
  },
  {
    version: '2.0.181',
    releasedAt: '2026-08-18',
    title: 'Unify Account and GROUP exposure search',
    changes: [
      'Combines Buyer and Supplier Account discovery into one exact-ID Company/GROUP search with lifetime role badges and GROUP-first results.',
      'Adds one Accounts directory with Both, Buyer, and Supplier views, currency-separated receivable, payable, informational net exposure, and period gross profit.',
      'Adds a combined Account or GROUP statement with separate buyer and supplier forecasts, fail-closed netting, and direct access to each authoritative directional statement.',
    ],
  },
  {
    version: '2.0.180',
    releasedAt: '2026-08-18',
    title: 'Add Supplier payable statements',
    changes: [
      'Adds exact-Account Supplier Credit Statements with issued payable balances, conservative uninvoiced estimates, currency-safe KPIs, and descending payment forecasts.',
      'Adds optional active-GROUP scope, invoice and supplier-child evidence, selectable copy details, and fail-closed identity or completeness safeguards.',
      'Adds a server-paginated Supplier statements directory and makes the Accounts tab inherit Dashboard Company/GROUP and Port/COUNTRY filters without a second search box.',
    ],
  },
  {
    version: '2.0.179',
    releasedAt: '2026-08-18',
    title: 'Split FCOS Updates queue from preparation',
    changes: [
      'Loads the first FCOS Updates screen from queue-only data while mailbox, recipient, and interrupted-delivery preparation continue in the background.',
      'Preserves the full live preparation response before any batch editing or delivery action becomes available.',
    ],
  },
  {
    version: '2.0.178',
    releasedAt: '2026-08-18',
    title: 'Open FCOS Updates faster',
    changes: [
      'Runs independent FCOS Updates database reads concurrently while re-reading batches only when interrupted-delivery recovery changes live state.',
      'Displays pending, sent, and skipped updates in compact 50-row pages instead of rendering the complete release archive at once.',
    ],
  },
  {
    version: '2.0.177',
    releasedAt: '2026-08-18',
    title: 'Tighten Dashboard filters and accelerate FCOS Updates',
    changes: [
      'Places the Company or GROUP and Port or COUNTRY searches together as one compact Dashboard filter group.',
      'Removes the calculation-explanation control from Account Insight.',
      'Opens the saved FCOS Updates queue immediately, checks release notes in the background, and keeps the queue usable during synchronization.',
    ],
  },
  {
    version: '2.0.174',
    releasedAt: '2026-08-17',
    title: 'Emphasize expected invoice copy details',
    changes: [
      'Removes the redundant Not Issued wording from copied Statement Evidence while keeping the interface warning unchanged.',
      'Underlines expected invoice amounts and due dates in rich-text destinations and surrounds those phrases with asterisks in plain text.',
    ],
  },
  {
    version: '2.0.173',
    releasedAt: '2026-08-17',
    title: 'Clarify Statement exposure quantities',
    changes: [
      'Uses ordered maximum quantities for Not Issued Statement Evidence exposure while preserving Salesforce QLIK quantities for credit reconciliation and forecasts.',
      'Sorts Statement Evidence by delivery date from newest to oldest and labels the forecast midpoint basis for un-invoiced quantity ranges.',
    ],
  },
  {
    version: '2.0.172',
    releasedAt: '2026-08-17',
    title: 'Calculate complete expected invoice totals',
    changes: [
      'Calculates Not Issued Buyer Invoice estimates from non-cancelled ordered product and extra-cost rows without using zero BDN quantities.',
      'Uses maximum quantities for range orders, identifies those rows as BASIS MAX QTY, groups Not Issued STEMs, and combines actual and expected values into one clearly marked total.',
    ],
  },
  {
    version: '2.0.171',
    releasedAt: '2026-08-17',
    title: 'Include expected invoice amounts',
    changes: [
      'Adds the live Salesforce STEM invoice total to copied Statement Evidence when the Buyer Invoice has not yet been issued.',
      'Keeps Not Issued explicit, labels the value as Expected Invoice Amount, and appends currency-separated expected-amount totals.',
    ],
  },
  {
    version: '2.0.170',
    releasedAt: '2026-08-17',
    title: 'Clarify expected invoice due dates',
    changes: [
      'Keeps the Salesforce-backed expected due date in copied Statement Evidence for STEMs whose buyer invoice is Not Issued.',
      'Labels that date as Expected Due Date and omits overdue or due-soon status until an actual buyer invoice exists.',
      'Places each Payment Collection queue Select all or Clear all control directly beside the filter label it changes.',
      'Opens and resets Dashboard to Year to date by default, with a new saved-filter version so the default takes effect immediately.',
      'Applies Dashboard buyer Account/GROUP and Port/COUNTRY filters to Account Statements, prioritizes GROUP and COUNTRY suggestions, and standardizes COUNTRY labels.',
    ],
  },
  {
    version: '2.0.169',
    releasedAt: '2026-08-17',
    title: 'Make Account Insight exports decision-ready',
    changes: [
      'Replaces empty or decorative Account Insight PDF charts with an executive KPI summary, recent-period figures, meaningful payment and risk sections, and ranked STEM tables with repeated page headers.',
      'Loads Salesforce UOM and Product UOM fallbacks for extra costs and limits missing-UOM alerts to quantity-priced rows that actually require a unit.',
      'Highlights statement STEMs without buyer invoices as Not Issued, allows them to be copied, and separates issued invoice totals from the explicit not-issued count.',
    ],
  },
  {
    version: '2.0.168',
    releasedAt: '2026-08-17',
    title: 'Clarify Salesforce credit capacity',
    changes: [
      'Applies Salesforce Individual, Group, and Special credit-category policies exactly, including uncapped GROUP sharing for COSCO and a one-unit threshold before showing calculated availability differences.',
      'Moves applicable positive credit limits into a compact forecast legend, removes overlapping zero-limit labels, and removes the monthly buyer/supplier gross-profit chart and payload.',
      'Hides Special Term live and draft document previews when neither live nor draft Terms Text contains a clause.',
      'Adds an N/A change-reason toggle that disables the whole-term reason field and submits N/A as the governed revision reason.',
    ],
  },
  {
    version: '2.0.167',
    releasedAt: '2026-08-14',
    title: 'Enforce DEVEE-first Salesforce promotion',
    changes: [
      'Pins DEVEE as the only Salesforce development/source environment and records the fixed DEVEE → shared GitHub → QAT → Production promotion order in System Health.',
      'Requires a fresh successful DEVEE deployment proof for the exact Salesforce source-tree hash before the shared repository can be updated.',
      'Records Otto for primary FCOS authentication and vincexai as the isolated shared Salesforce GitHub browser fallback while retaining CLI-first verification.',
    ],
  },
  {
    version: '2.0.166',
    releasedAt: '2026-08-14',
    title: 'Guarantee shared Salesforce contribution attribution',
    changes: [
      'Pins the non-secret GitHub account ID for the shared Salesforce mirror and requires both commit author and committer to resolve to `vincelessxai` before publication succeeds.',
      'Rebuilds an existing mirror branch from current shared main with an exact remote-head lease, preventing stale or divergent publication history.',
      'Documents inherited Ship-Agent readiness metadata and byte-equivalent source evidence on the current shared pull request for repository-owner review.',
    ],
  },
  {
    version: '2.0.165',
    releasedAt: '2026-08-14',
    title: 'Justify Special Term clause text',
    changes: [
      'Aligns complete clause lines to both A4 margins while keeping each paragraph’s final line naturally left-aligned in the local preview, PDF, and Word exports.',
      'Preserves the compact right-aligned number column and hanging text indent across numbered clauses, nested bullets, page continuations, and legacy wording.',
      'Verifies the shared alignment tokens and native Word paragraph justification without changing Salesforce contractual text.',
    ],
  },
  {
    version: '2.0.164',
    releasedAt: '2026-08-14',
    title: 'Improve Special Term document typography',
    changes: [
      'Increased Special Term body copy to readable 12 pt Arial with 1.25 line spacing across the A4 preview, PDF, and Word exports.',
      'Rebuilt numbered and nested-list geometry with compact right-aligned markers, a consistent text column, aligned wrapped lines, and symmetric page margins.',
      'Converts preserved Salesforce rich-text markup and tab separators to safe document text before preview and export without rewriting contractual wording.',
    ],
  },
  {
    version: '2.0.163',
    releasedAt: '2026-08-14',
    title: 'Publish professional Special Term documents',
    changes: [
      'Restored live PDF downloads and added editable Word exports from Salesforce-authoritative Terms Text while excluding Confirmation and Nomination remarks.',
      'Added a synchronized responsive A4 preview with shared letterhead, typography, numbering, nested bullets, draft watermarking, pagination, and live-versus-draft controls.',
      'Fail-closes structured exports on stale records or clause-compilation drift, keeps legacy wording unchanged, and records only redacted document audit metadata.',
    ],
  },
  {
    version: '2.0.162',
    releasedAt: '2026-08-13',
    title: 'Enforce the shared Salesforce mirror',
    changes: [
      'Pins the separate vincelessxai authorization and ivanyk20/fcbhk repository as mandatory non-secret Salesforce publication targets in System Health.',
      'Publishes the complete FCOS Salesforce metadata tree into the shared repository after successful Production, Devee, and QAT deployment while preserving unrelated shared source.',
      'Blocks FCOS pushes containing Salesforce changes until the shared branch is byte-equivalent and records its owned-file inventory for safe future removals.',
    ],
  },
  {
    version: '2.0.161',
    releasedAt: '2026-08-13',
    title: 'Render Special Term remarks cleanly',
    changes: [
      'Converts preserved Salesforce rich-text Confirmation and Nomination remarks to readable bullet text in whole-term migration previews instead of showing HTML markup.',
    ],
  },
  {
    version: '2.0.160',
    releasedAt: '2026-08-12',
    title: 'Scope and restore Ship-Agent reconciliation',
    changes: [
      'Limits Ship-Agent Charges detection, reconciliation, and consequential actions to STEM records created on or after 1 January 2026.',
      'Filters related Salesforce line-item and extra-cost queries at source to avoid scanning irrelevant historical records.',
      'Repairs the Ship-Agent case synchronization function that caused automatic Payment Collections reconciliation to report unavailable.',
    ],
  },
  {
    version: '2.0.159',
    releasedAt: '2026-08-12',
    title: 'Refresh Email Router across FCOS tabs',
    changes: [
      'Broadcasts each completed 30-second mailbox check to every open FCOS tab so the visible Email Router list refreshes even when another tab owns the browser lock.',
      'Keeps server-side mailbox claims and adds a safe no-BroadcastChannel fallback without sharing mailbox or message content between tabs.',
      'Removes the requested routing explanations and compacts redirect, recipient, preset, filing, send, and advisor controls to reduce scrolling.',
    ],
  },
  {
    version: '2.0.158',
    releasedAt: '2026-08-11',
    title: 'Clear recovered Email Router maintenance alerts',
    changes: [
      'Automatically handles older Email Router maintenance incidents only after a later complete scheduled run succeeds.',
      'Protects concurrent failures by resolving only incidents that predate the successful maintenance run.',
      'Strengthens manual recovery verification to require fresh synchronization and active subscriptions for Inbox, Sent Items, and Archive.',
    ],
  },
  {
    version: '2.0.157',
    releasedAt: '2026-08-10',
    title: 'Verify and clear recovered FCOS incidents',
    changes: [
      'Added live recovery checks for Special Terms, Hedge Salesforce mapping, Email Router maintenance, legacy Salesforce queries, and controlled bootstrap incidents.',
      'Prevented development and preview failures from creating global production notification records unless an explicit isolated override is enabled.',
      'Kept incident audit events intact while allowing verified recoveries to move every active user notification to Handled.',
    ],
  },
  {
    version: '2.0.156',
    releasedAt: '2026-08-10',
    title: 'Refresh changed Salesforce schemas automatically',
    changes: [
      'Retries Special Terms schema validation once against live Salesforce when a cached description predates a metadata deployment.',
      'Keeps genuine schema or access mismatches fail-closed after the forced revalidation.',
    ],
  },
  {
    version: '2.0.155',
    releasedAt: '2026-08-10',
    title: 'Reuse clauses in Special Term remarks',
    changes: [
      'Extended the Salesforce Clause Bank to independent Terms Text, Confirmation remark, and Nomination remark projections without duplicating approved wording.',
      'Replaced free-form remark editing with clause-by-clause plus controls and reviewed Numbered or Hyphen compilation, while preserving each original remark for audited rollback.',
      'Expanded live-corpus migration review, stale-write enforcement, idempotent all-or-none writes, and Salesforce direct-edit guards across all three projections.',
    ],
  },
  {
    version: '2.0.154',
    releasedAt: '2026-08-10',
    title: 'Reuse approved numbered Special Term clauses',
    changes: [
      'Replaced free-form Terms Text editing with a numbered clause composer backed by versioned Salesforce clause identities, immutable approved wording, and selective per-row upgrades.',
      'Added Draft, approval, retirement, and review-gated legacy migration workflows with active General Manager or Administrator control and preserved original wording.',
      'Kept Terms_Text__c as the sequential plain-text Salesforce projection while adding stale-write protection, all-or-none assignment changes, targeted caching, and redacted service-only operation history.',
    ],
  },
  {
    version: '2.0.153',
    releasedAt: '2026-08-10',
    title: 'Pin Git pushes to the FCOS identity',
    changes: [
      'Bound plain Git HTTPS pushes to the repository-isolated hocheunglai-oss GitHub authorization without changing the Mac\'s global credential helper.',
      'Added a tracked pre-push identity guard and made credential-helper or hook drift fail the GitHub target pin in System Health.',
    ],
  },
  {
    version: '2.0.152',
    releasedAt: '2026-08-10',
    title: 'Publish signed connection health',
    changes: [
      'Replaced manual browser checklist records with live Ed25519-signed, service-only connection attestations backed by one schema-validated target policy.',
      'Moved Vercel and Supabase credentials to dedicated macOS Keychain items, pinned critical CLI versions, and added parallel identity, target, permission, and credential-lifecycle probes.',
      'Added attestation freshness to System Health and redacted publication events to the Universal Audit Trail without storing provider secrets or CLI output.',
    ],
  },
  {
    version: '2.0.151',
    releasedAt: '2026-08-09',
    title: 'Pin durable FCOS provider authorization',
    changes: [
      'Added a single fail-closed connection command that revalidates the exact GitHub, Vercel, Supabase, and Salesforce targets before delegated CLI use.',
      'Isolated GitHub, Vercel, and Supabase authorization under ignored repo-local profiles, pinned the Supabase CLI version, and isolated the Salesforce target while retaining its protected host credential store.',
      'Expanded System Health with the non-secret account, team, project, org, profile, isolation mechanism, and local config policy for every connection.',
    ],
  },
  {
    version: '2.0.150',
    releasedAt: '2026-08-09',
    title: 'Enforce the CLI-first connection checklist',
    changes: [
      'Added a Connection Checklist view under System Health for the approved GitHub, Vercel, Supabase, and Salesforce targets.',
      'Enforced CLI availability, exact non-secret target verification, and CLI use before allowing the Otto Chrome profile solely for a recorded CLI authentication failure.',
      'Kept checklist persistence browser-local and schema-limited so CLI output, tokens, secrets, and arbitrary credential text cannot be recorded.',
    ],
  },
  {
    version: '2.0.149',
    releasedAt: '2026-08-08',
    title: 'Show connection cleanup warnings accurately',
    changes: [
      'Kept healthy provider connectivity online while showing non-blocking System Health warnings for redundant or legacy connection configuration that still needs cleanup.',
    ],
  },
  {
    version: '2.0.148',
    releasedAt: '2026-08-08',
    title: 'Clear transitive dependency advisories',
    changes: [
      'Updated DOMPurify, nanoid, and js-yaml within their existing compatible dependency ranges after the production install audit identified current advisories.',
      'Retained the declared application dependency contract while restoring a zero-vulnerability npm audit result.',
    ],
  },
  {
    version: '2.0.147',
    releasedAt: '2026-08-08',
    title: 'Faster startup and clearer connection health',
    changes: [
      'Loaded independent workspace and navigation preferences together to shorten signed-in startup without weakening revision checks.',
      'Moved the full version audit history and navigation drag-and-drop editor out of the initial browser bundle, and restored release dates for the newest audit entries.',
      'Unified server-side Supabase key resolution for current secret keys and legacy service-role keys, and surfaced redundant Salesforce authentication modes in System Health.',
      'Stopped hidden or duplicate Chrome tabs from repeating Email Router synchronization, rejected impossible negative capacity metrics, and labeled the gated Outlook calendar as intentionally disabled.',
    ],
  },
  {
    version: '2.0.146',
    releasedAt: '2026-08-08',
    title: 'Gate final invoices on ship-agent charges',
    changes: [
      'Added the Ship-Agent Charges Payment Collections queue with delivery timing, assigned Buyer Trader review, controlled Salesforce extra-cost changes, and documented General Manager overrides.',
      'Added service-only revisioned confirmation, operation, event, notification, and commitment workflows without mirroring Salesforce financial records.',
      'Blocked final buyer invoice creation, generation, and sending until shared live Salesforce readiness passes, while preserving proforma and credit-note flows.',
    ],
  },
  {
    version: '2.0.145',
    releasedAt: '2026-08-08',
    title: 'Restore original recipients in Redirect Reply All',
    changes: [
      'Restored the original sender and visible original To and Cc participants when a redirected-message recipient uses Reply All.',
      'Excluded the connected shared mailbox and all original Bcc recipients from the restored reply route.',
      'Added Microsoft 365 draft verification and a regression case covering an external sender, shared mailbox, original Cc, and one redirect recipient.',
    ],
  },
  {
    version: '2.0.144',
    releasedAt: '2026-08-08',
    title: 'Clear redirect recipients and reply behavior',
    changes: [
      'Restored the original message From, To, and Cc details inside every Email Router redirect.',
      'Kept reviewed redirect To and Cc recipients visible to one another while preserving Bcc privacy and recipient order.',
      'Directed Reply to the original sender and Reply All to the original sender plus the visible redirect recipients, with live Microsoft 365 draft verification before submission.',
    ],
  },
  {
    version: '2.0.143',
    releasedAt: '2026-08-07',
    title: 'Rich-text Special Terms editing',
    changes: [
      'Replaced the Special Terms wording textarea with a sanitized rich-text editor designed around numbered contractual clauses.',
      'Kept existing Salesforce plain-text wording unchanged until a user deliberately edits and saves the term.',
      'Prepared Special Terms display and search to handle both existing plain text and reviewed rich-text wording while PDF downloads remain disabled.',
    ],
  },
  {
    version: '2.0.142',
    releasedAt: '2026-08-07',
    title: 'Expanded Email Router mailboxes',
    changes: [
      'Added Market Report, Trash, and Junk mailbox views beside Inbox, Sent, and Archive, with Junk clearly highlighted in red.',
      'Removed the duplicate Reply and Forward action buttons because Forward remains available in the reviewed Route Message panel.',
      'Made Market Report routing recognize the connected mailbox folder whether Microsoft 365 names it Market Report or Market Reports.',
    ],
  },
  {
    version: '2.0.141',
    releasedAt: '2026-08-07',
    title: 'Forward-and-file Email Router workflow',
    changes: [
      'Unified Forward and Redirect in the fixed Route Message panel with ordered To, Cc, and Bcc recipients and no separate Forward confirmation window.',
      'Added reviewed post-action filing to Archive or Administrator-approved Microsoft 365 folders, with source movement only after Sent Items confirmation and a move-only retry safeguard.',
      'Added privacy-protected company routing learning that requires three similar confirmed outcomes and confidence above 60% before preselecting an action, recipients, or folder.',
    ],
  },
  {
    version: '2.0.140',
    releasedAt: '2026-08-07',
    title: 'Safer redirects and direct message actions',
    changes: [
      'Fixed valid Outlook messages being rejected during Redirect because of harmless original Bcc, Resent, or missing Message-ID headers.',
      'Moved Reply, Forward, Archive, Trash, and Market Report controls into a distinct action toolbar above the selected message.',
      'Added a one-click, server-validated move to the exact Microsoft 365 Market Report folder with duplicate-folder protection.',
    ],
  },
  {
    version: '2.0.139',
    releasedAt: '2026-08-07',
    title: 'Live Microsoft 365 redirect confirmation',
    changes: [
      'Made Email Router follow each secured outgoing action through Microsoft 365 submission and Sent Items confirmation without requiring a page refresh.',
      'Replaced the indefinite Queued securely state with live Sending securely, Confirming, Confirmed, or a bounded uncertain outcome.',
      'Preserved the durable no-duplicate-send safeguard while using the five-minute maintenance job only as recovery fallback.',
    ],
  },
  {
    version: '2.0.138',
    releasedAt: '2026-08-07',
    title: 'Simplified Email Router navigation and leave management',
    changes: [
      'Removed the Email Router page tabs and moved Routing Setup into a permission-controlled modal opened from the mailbox toolbar.',
      'Consolidated personal and company routing availability into one Routing Leave window, with company-wide controls limited to Administrators and the active General Manager.',
      'Reduced the Email Router header height and removed the Operations label, descriptive copy, and loaded-message count.',
    ],
  },
  {
    version: '2.0.137',
    releasedAt: '2026-08-07',
    title: 'Fixed Email Router action-status placement',
    changes: [
      'Moved transient Email Router action results into a persistent page-header status area between the mailbox identity and page actions.',
      'Removed duplicate confirmed, submitted, uncertain, and failed result banners from the selected-message pane while retaining its permanent action history.',
    ],
  },
  {
    version: '2.0.136',
    releasedAt: '2026-08-06',
    title: 'Embedded email images and immediate redirect archiving',
    changes: [
      'Restored embedded PNG, JPEG, GIF, and WebP letterhead images while continuing to block SVG, HTML, scriptable, malformed, and oversized data sources.',
      'Moved redirected source messages to Archive immediately after Microsoft Graph accepts the outgoing message instead of waiting for the five-minute reconciliation job.',
      'Removed successfully queued redirects from the open Inbox immediately while durable Sent Items confirmation continues in the background.',
    ],
  },
  {
    version: '2.0.135',
    releasedAt: '2026-08-06',
    title: 'Faster Email Router and message rendering repair',
    changes: [
      'Fixed emails such as AICC FENGHUANG displaying hidden WYSIWYG stylesheet comments as visible message content.',
      'Made message bodies, action history, and known attachment metadata load concurrently, stopped 30-second inbox refreshes from reopening the selected message, and removed duplicate routing-directory requests.',
      'Prepared short-lived attachment streams with message details so previews and downloads normally avoid an extra request, while preserving authorization and expiry checks.',
      'Made Archive update the inbox immediately and let Redirect return after its Microsoft 365 draft is durably recorded while protected submission continues in the background.',
      'Added redacted operation timing for mailbox lists, message details, attachments, and mail actions without recording message or recipient data.',
    ],
  },
  {
    version: '2.0.134',
    releasedAt: '2026-08-06',
    title: 'Trade-date broker settlements',
    changes: [
      'Separated broker settlement from the general Hedge pricing-month close and now assigns each broker commission to the month of its trade date.',
      'Reopened every historical broker/month settlement for review without changing FCBS invoices or SFS report history.',
      'Added per-broker settlement status, revision protection, audit history, and change detection when trades or commission rates change after settlement.',
    ],
  },
  {
    version: '2.0.133',
    releasedAt: '2026-08-06',
    title: 'Monthly Hedge broker commissions',
    changes: [
      'Added an all-history monthly broker commission ledger to Hedge Desk Settlement, grouped by trade month and broker with trade counts and monthly totals.',
      'Included newly configured broker names in commission totals instead of restricting the calculation to the original fixed broker list.',
    ],
  },
  {
    version: '2.0.132',
    releasedAt: '2026-08-06',
    title: 'Faster Email Router actions',
    changes: [
      'Made Archive a one-click action without a confirmation window and removed the redundant Microsoft Graph message preflight.',
      'Reduced Redirect latency by processing only the newly requested outbox action and leaving Sent Items confirmation to durable background reconciliation.',
    ],
  },
  {
    version: '2.0.131',
    releasedAt: '2026-08-06',
    title: 'Live Email Router Inbox refresh',
    changes: [
      'Fixed open Email Router lists remaining stale when another user or tab won the shared 30-second mailbox synchronization claim.',
      'Every successful heartbeat now refreshes an open Inbox silently, including when the current tab reports that synchronization was completed elsewhere.',
    ],
  },
  {
    version: '2.0.130',
    releasedAt: '2026-08-06',
    title: 'App-wide Email Router synchronization',
    changes: [
      'Added a 30-second Email Router mailbox synchronization heartbeat across every FCOS page for users with Email Router access.',
      'Added a server-side mailbox claim so simultaneous users and tabs share one Graph delta synchronization instead of duplicating calls.',
      'Refreshes open Email Router message lists from the background heartbeat while retaining Graph notifications and scheduled recovery.',
    ],
  },
  {
    version: '2.0.129',
    releasedAt: '2026-08-06',
    title: 'Special Terms document review',
    changes: [
      'Temporarily disabled FCOS-generated Special Term PDF downloads in both the workspace and server while typography, margins, and numbered-list alignment are redesigned.',
      'Kept Salesforce Confirmation and Nomination attachment settings and Special Term remark copying unchanged.',
    ],
  },
  {
    version: '2.0.128',
    releasedAt: '2026-08-06',
    title: 'Readable mobile workspaces',
    changes: [
      'Reserved the icon dock width on mobile so page headings, controls, selection toolbars, and table content remain visible beside the sidebar.',
    ],
  },
  {
    version: '2.0.127',
    releasedAt: '2026-08-06',
    title: 'Individual Special Terms documents',
    changes: [
      'Replaced the Special Terms register with selectable, standalone PDFs containing only the authoritative term name and Terms Text beneath the approved company letterhead.',
      'Added ordered multiple downloads with progress, duplicate filename suffixes, and retry retention for failed documents.',
      'Added plain-text copy controls for Confirmation and Nomination special remarks in both the Terms table and editing window.',
    ],
  },
  {
    version: '2.0.126',
    releasedAt: '2026-08-06',
    title: 'Special Terms PDF register',
    changes: [
      'Added a PDF download to Special Terms that follows the current Terms or Rules view and search filter.',
      'Generated the report server-side from authoritative Salesforce data with term wording, document remarks, linked rule conditions, source time, and page numbering.',
      'Kept Salesforce record IDs out of the visible report and recorded only redacted export scope and counts in the audit trail.',
    ],
  },
  {
    version: '2.0.125',
    releasedAt: '2026-08-06',
    title: 'Security and financial workflow hardening',
    changes: [
      'Replaced browser-supplied Salesforce queries with server-owned Dashboard filters and made Interoffice data restrictions fail closed when Salesforce metadata cannot be validated.',
      'Moved financial-report recipients and templates into approved server settings so browser or fallback values cannot restore an obsolete address or alter an internal report.',
      'Added currency-specific Payment Collection closure thresholds and kept the strict below-0.005 rule for currencies without an approved threshold.',
      'Standardized financial calculations on Salesforce native quantity and UOM while retaining approximate density conversion only for volume statistics.',
      'Kept externally closed Salesforce disputes in FCOS until accounting is complete or an authorized external-closure acceptance is recorded with a reason.',
      'Improved Account Insight exception classification, Email Router availability, safe error messages, targeted incident verification, and release security checks.',
    ],
  },
  {
    version: '2.0.124',
    releasedAt: '2026-08-06',
    title: 'Account Insight data labels',
    changes: [
      'Replaced every generic Unspecified label in Account Insight with the exact missing field, such as Currency not set, Product not set, Port not set, UOM not set, Date not set, or Reason not set.',
      'Removed secondary buyer-broker commission messages from Account Insight data warnings while retaining validated line-item commission calculations.',
    ],
  },
  {
    version: '2.0.123',
    releasedAt: '2026-08-06',
    title: 'Sidebar glass layering correction',
    changes: [
      'Kept the expanded sidebar caption glass above Dashboard filters while preserving its position below application dialogs.',
      'Reduced the caption sheet opacity and blur radius so underlying page content remains visibly blurred through the liquid material.',
    ],
  },
  {
    version: '2.0.122',
    releasedAt: '2026-08-06',
    title: 'Fixed-position dock expansion',
    changes: [
      'Kept every sidebar icon at the same horizontal and vertical position when the caption pane expands.',
    ],
  },
  {
    version: '2.0.121',
    releasedAt: '2026-08-06',
    title: 'Liquid caption dock default',
    changes: [
      'Made Icon and caption the default sidebar behavior for existing and future users.',
      'Confined the liquid translucent treatment to the expanded caption pane while preserving the established icon and label styling.',
    ],
  },
  {
    version: '2.0.120',
    releasedAt: '2026-08-05',
    title: 'Two-mode application dock',
    changes: [
      'Removed sidebar auto-hide and replaced the workspace preference with Icon only and Icon and caption modes.',
      'Added whole-dock caption expansion on sidebar hover, single-line labels, and focused row magnification without resizing the active page.',
    ],
  },
  {
    version: '2.0.119',
    releasedAt: '2026-08-05',
    title: 'Icon dock active-state correction',
    changes: [
      'Corrected tooltip and navigation composition so inactive dock icons retain their slate color and the current page receives the intended blue active background.',
    ],
  },
  {
    version: '2.0.118',
    releasedAt: '2026-08-05',
    title: 'Translucent application icon dock',
    changes: [
      'Replaced the text-heavy application sidebar with a 72-pixel translucent icon dock that magnifies icons and shows complete floating captions on hover or keyboard focus.',
      'Preserved grouped navigation, active-page indication, notifications, user identity, Settings access, auto-hide behavior, and a temporary expanded mode for navigation customization.',
    ],
  },
  {
    version: '2.0.117',
    releasedAt: '2026-08-05',
    title: 'Readable compact sidebar labels',
    changes: [
      'Kept the compact application sidebar while allowing long navigation labels to wrap cleanly instead of hiding their final letters.',
    ],
  },
  {
    version: '2.0.116',
    releasedAt: '2026-08-05',
    title: 'Compact application sidebar',
    changes: [
      'Reduced the fixed and auto-hide application sidebar width by approximately 30% while preserving labelled navigation and hover access to truncated page names.',
      'Moved Version Audit Trail and Sign out from the application sidebar into the Settings navigator on desktop and mobile.',
    ],
  },
  {
    version: '2.0.115',
    releasedAt: '2026-08-05',
    title: 'Simplified Dashboard STEM table',
    changes: [
      'Removed raw Port references, Exception Schedule, uncancelled-product flags, and Extra Costs from the Dashboard Filtered STEMs table while retaining them for calculations and search.',
      'Simplified Buyer and Buyer GROUP labels to the Account name while preserving exact Account identity for Account Insight.',
    ],
  },
  {
    version: '2.0.114',
    releasedAt: '2026-08-05',
    title: 'Account Insight Salesforce schema fix',
    changes: [
      'Fixed Account Insight so secondary buyer-broker fields are selected only after Salesforce describe confirms they exist.',
      'Kept Account Insight available when Salesforce has no secondary buyer-broker commission field by using validated line-item commissions and showing a clear data warning.',
    ],
  },
  {
    version: '2.0.113',
    releasedAt: '2026-08-05',
    title: 'Account insight, faster navigation, and controlled improvements',
    changes: [
      'Added exact-Account Dashboard insights with role-specific trading, profitability, payment, risk, STEM, and GROUP analysis plus PDF and CSV exports.',
      'Added navigation-aware browser snapshots so recent pages reopen immediately, moderately stale pages refresh in the background, and manual Refresh continues to retrieve live data.',
      'Assigned new FCOS Improvements tickets by default to the active UUID-backed General Manager while preserving controlled reassignment and approval history.',
      'Completed FCOS-000001 by removing the PSPRS column from external payment-reminder invoice tables and previews without changing internal reports or Payment Collections data.',
    ],
  },
  {
    version: '2.0.112',
    releasedAt: '2026-08-05',
    title: 'Special Terms page restored',
    changes: [
      'Restored the Special Terms workspace by keeping Salesforce response-status data in the page component that loads and displays it.',
      'Added a regression check that prevents the response-status state from being moved outside the Special Terms page scope again.',
    ],
  },
  {
    version: '2.0.111',
    releasedAt: '2026-08-05',
    title: 'Unified and compact Settings workspace',
    changes: [
      'Unified Dashboard Search, Hedge Trading Assistant, and Email Router Advisor model selection and usage into one consistent, purpose-based format.',
      'Redesigned Email Delivery for dense mailbox and purpose tables with one audited, all-or-none save for multiple sender assignment changes.',
      'Condensed People & Access into searchable user and user-type tables and removed its duplicate audit list in favor of the Universal Audit Trail.',
      'Standardized Settings navigation, panel width, typography, spacing, controls, and section-specific methodology across desktop and mobile layouts.',
    ],
  },
  {
    version: '2.0.110',
    releasedAt: '2026-08-05',
    title: 'Single-source sidebar preferences',
    changes: [
      'Removed the duplicate sidebar mode arrow and navigation-order pencil from the sidebar; both preferences remain managed through My Settings.',
      'Preserved left-edge hover for auto-hide mode and the existing drag, visibility, reset, cancel, and save workflow when navigation editing is opened from Settings.',
    ],
  },
  {
    version: '2.0.109',
    releasedAt: '2026-08-05',
    title: 'Role-aware Settings workspace',
    changes: [
      'Reorganized Settings into Personal, Administration, and Operations sections with mobile navigation, role-aware visibility, stable links, and section-specific save actions.',
      'Synchronized sidebar, table-density, navigation, and STEM document preferences across browsers while retaining local settings only as an offline cache.',
      'Moved Email Router, Hedge Desk, Broker Commissions, AI Models, FCOS Updates, System Health, and Audit controls to their owning workflows and introduced one authoritative company exchange-rate provider.',
    ],
  },
  {
    version: '2.0.108',
    releasedAt: '2026-08-04',
    title: 'Shared FCOS Improvements ticketing',
    changes: [
      'Added FCOS Improvements for every active user to report reproducible bugs and measurable feature requests, attach private evidence, and follow one shared queue.',
      'Added General Manager approval for comments, assignments, ticket edits, and status changes, with pending proposals visible to everyone and stale decisions blocked server-side.',
      'Connected improvement approvals to My Commitments, unified notifications, the redacted Audit Trail, and a Codex helper that can inspect and propose changes but cannot approve them.',
    ],
  },
  {
    version: '2.0.107',
    releasedAt: '2026-08-04',
    title: 'Consistent page methodology and Hedge controls',
    changes: [
      'Standardized every page-level Methodology control on the labelled Book icon, typography, color, and size used by Markets and removed the duplicate Markets control.',
      'Centralized and refreshed the Account Managers, Cashflow, Growth & Coaching, Projects & Tasks, Email Router, Settings, trading, collection, dispute, and operational methodology guides against current workflow and permission rules.',
      'Removed obsolete Hedge Desk methodology navigation and counterparty banking inputs while preserving historical database values; settlement documents continue to rely on a counterparty-issued invoice when FCOS must pay.',
    ],
  },
  {
    version: '2.0.106',
    releasedAt: '2026-08-04',
    title: 'Report delivery and system error notifications',
    changes: [
      'Corrected the Microsoft Graph database context used by the Outstanding Buyer Invoices report, Incoming Payment report, and payment reminders so live delivery no longer fails with an undefined client.',
      'Added redacted and deduplicated system-error notifications for every active user while excluding normal validation and permission responses.',
      'Normalized blank optional Hedge Desk dates to no date and rejected invalid calendar dates before saving to PostgreSQL.',
    ],
  },
  {
    version: '2.0.105',
    releasedAt: '2026-08-04',
    title: 'Email images and leave-aware routing',
    changes: [
      'Restored embedded email images by resolving Microsoft 365 content identifiers even when Graph excludes inline-only items from its attachment flag, with a clear placeholder when an image is unavailable.',
      'Added self-managed routing leave, Administrator-managed company schedules, Standard and conditional preset versions, priority and specificity rules, and scheduled routing overrides.',
      'Protected reviewed preset recipients with a signed 60-minute snapshot, invalidated stale configuration safely, and warned without blocking when selected recipients are currently on leave.',
    ],
  },
  {
    version: '2.0.104',
    releasedAt: '2026-08-04',
    title: 'Case-sensitive Email Router labels',
    changes: [
      'Preserved uppercase and lowercase letters in Email Router directory labels and made label uniqueness use an exact case-sensitive comparison throughout Settings and server validation.',
    ],
  },
  {
    version: '2.0.103',
    releasedAt: '2026-08-04',
    title: 'Editable Email Router routing presets',
    changes: [
      'Changed routing presets into selectable labels that prefill numbered To, Cc, and Bcc recipients while keeping every recipient editable and switching off the preset label after an amendment.',
      'Made the case-preserved preset name the only user-visible identifier, enforced case-insensitive name uniqueness, and replaced the preset editor with the same ordered recipient-label controls used by Redirect.',
    ],
  },
  {
    version: '2.0.102',
    releasedAt: '2026-08-04',
    title: 'Email Router message display repair',
    changes: [
      'Kept the full message body available when Microsoft Graph cannot return an attachment collection, and retrieved inline-image identifiers only from compatible attachment records.',
      'Restored safe newsletter table formatting and HTTPS images while containing wide content inside the message viewer.',
    ],
  },
  {
    version: '2.0.101',
    releasedAt: '2026-08-04',
    title: 'Email Router workflow hardening',
    changes: [
      'Restored ordered manual To, Cc, and Bcc recipients for Redirect and Forward while keeping preset and directory recipients validated server-side.',
      'Made routing-directory, group, and preset changes atomic so active presets cannot retain unavailable recipients, and corrected exact-action Undo and inline-image handling.',
      'Hardened Hedge Desk settlement, Salesforce synchronization, document, and maintenance workflows so failed database outcome tracking cannot be reported as successful.',
    ],
  },
  {
    version: '2.0.100',
    releasedAt: '2026-08-04',
    title: 'Fixed Email Router preset recipients',
    changes: [
      'Corrected routing preset validation so a selected person is not rejected because its intentionally empty group field is present, and vice versa.',
      'Made removed or excluded preset recipients visible and repairable before saving.',
    ],
  },
  {
    version: '2.0.99',
    releasedAt: '2026-08-04',
    title: 'Fixed Email Router directory saving',
    changes: [
      'Aligned Email Router audit validation with whole-directory ordering changes so adding, reordering, and saving contacts or groups no longer ends with an event constraint error.',
    ],
  },
  {
    version: '2.0.98',
    releasedAt: '2026-08-03',
    title: 'Fixed Email Router redirect workspace',
    changes: [
      'Moved Redirect into a permanent right-side composer with Bcc hidden by default, one explicit Send Redirect action, and the Email Router Advisor directly below Send.',
      'Preselected the Advisor\'s ordered To, Cc, and Bcc recommendations only above 60% confidence while keeping every redirect under explicit user control.',
      'Allowed retained inactive external routing contacts to be restored safely instead of failing with a duplicate-email error.',
    ],
  },
  {
    version: '2.0.97',
    releasedAt: '2026-08-03',
    title: 'Ordered Email Router directory',
    changes: [
      'Combined FCOS users, approved external contacts, and routing groups into one Administrator-controlled directory with drag-and-drop ordering and revision-safe saving.',
      'Made Redirect a prominent labeled action and numbered every To, Cc, and Bcc selection while preserving the same visible recipient sequence in the outgoing message.',
    ],
  },
  {
    version: '2.0.96',
    releasedAt: '2026-08-03',
    title: 'Hedge settlement delivery history repair',
    changes: [
      'Corrected the settlement-email duplicate-delivery check to use the Hedge operations table’s actual creation timestamp column, restoring safe email preparation before Microsoft Graph submission.',
    ],
  },
  {
    version: '2.0.95',
    releasedAt: '2026-08-03',
    title: 'Exact settlement letterhead contact band',
    changes: [
      'Matched the settlement invoice contact band to the company reference by reducing the rule spacing to three millimetres and applying the sampled Fratelli blue to the company name, contact text, and both rules.',
    ],
  },
  {
    version: '2.0.94',
    releasedAt: '2026-08-03',
    title: 'Settlement invoice letterhead and layout refinement',
    changes: [
      'Added the company telephone number and general email between full-width letterhead rules, used full legal company names, integrated settlement totals into the payment-direction panel, simplified the footer, and compacted invoices with fewer than twelve trades onto one page where content permits.',
    ],
  },
  {
    version: '2.0.93',
    releasedAt: '2026-08-03',
    title: 'Settlement invoice letterhead restoration',
    changes: [
      'Restored the original centred Fratelli Cosulich company letterhead, address, title band, and footer wording on Hedge Desk settlement invoices without changing payment-direction or beneficiary logic.',
    ],
  },
  {
    version: '2.0.92',
    releasedAt: '2026-08-03',
    title: 'Email Router recipient loading clarity',
    changes: [
      'Replaced the temporary empty-directory message in Redirect and Forward with an explicit loading state while FCOS retrieves the included users and routing presets.',
    ],
  },
  {
    version: '2.0.91',
    releasedAt: '2026-08-03',
    title: 'Email Router active-user directory and recipient controls',
    changes: [
      'Restricted the Email Router routing directory to active FCOS users and added editable initial-based nicknames with Administrator-controlled inclusion.',
      'Restored independent To, Cc, and Bcc recipient selection for Redirect and Forward while showing nickname-only routing labels.',
      'Corrected the Email Router Advisor structured request and added clearer model, authentication, and API-limit failure messages.',
    ],
  },
  {
    version: '2.0.90',
    releasedAt: '2026-08-03',
    title: 'Access display and Hedge invoice deletion repair',
    changes: [
      'Corrected Users & Access so the protected Administrator and General Manager user types display their effective Email Router access as checked instead of showing a misleading unchecked box.',
      'Fixed Hedge Desk invoice deletion when generated PDFs are linked by removing document metadata atomically, cleaning up private stored files, and clearly marking the deletion as permanent.',
    ],
  },
  {
    version: '2.0.89',
    releasedAt: '2026-08-03',
    title: 'Email Router access and settlement delivery repair',
    changes: [
      'Made Email Router visibility configurable by user type or individual override in Users & Access while preserving access for every existing user during rollout.',
      'Fixed Email Router Settings profile loading and the Hedge settlement Microsoft Graph tracking error that could appear after an accepted submission.',
      'Added a readable rich-text settlement email preview, stable uncertain-send protection, and a redesigned professional settlement PDF with explicit payer and beneficiary details.',
      'Removed the application selector and portal landing from the FCOS interface while retaining the dormant server-side federation foundation for future applications.',
    ],
  },
  {
    version: '2.0.88',
    releasedAt: '2026-08-03',
    title: 'Native FCOS Email Router',
    changes: [
      'Integrated Inbox, Sent, Archive, message review, attachment preview, Redirect, Reply, Forward, Archive, Delete, Undo, and controlled uncertain-send review directly into FCOS.',
      'Moved Email Router directory, groups, presets, mailbox health, and AI Advisor controls into FCOS Settings while granting every active user operator access.',
      'Replaced portal handoff and standalone identity with FCOS authentication, metadata-only Supabase storage, immutable Microsoft Graph synchronization, and mailbox-scoped Graph actions.',
      'Added durable draft, submitted, confirmed, failed, and uncertain action states so Graph acceptance is never presented as completed delivery before Sent Items confirmation.',
    ],
  },
  {
    version: '2.0.87',
    releasedAt: '2026-08-03',
    title: 'Payment Collection dispute visibility',
    changes: [
      'Highlighted disputed STEMs in Payment Collections with distinct active-dispute, closed-history, and status-review indicators while preserving existing overdue colours.',
      'Added dispute status to Payment Collection search and a With dispute / No dispute filter without changing reminder or collection workflow rules.',
    ],
  },
  {
    version: '2.0.86',
    releasedAt: '2026-08-02',
    title: 'Amount-based buyer payment posting reconciliation',
    changes: [
      'Compared all newly detected buyer payments with the expected Salesforce receivable-balance movement and separated pending, partial, mismatched, and overdue posting exceptions.',
      'Added visible reconciliation arithmetic and Hong Kong business-day age to Payment Collections, and paused every external reminder route while a posting discrepancy remains active.',
      'Added an audited, issue-specific reminder override for Finance, Administrators, and the General Manager; changed payment evidence automatically invalidates the override.',
    ],
  },
  {
    version: '2.0.85',
    releasedAt: '2026-08-02',
    title: 'Complete CIA payment classification',
    changes: [
      'Classified partial and fully settled buyer receipts as CIA when received on or before either the earliest ETA or actual delivery date, with inclusive date boundaries.',
      'Added received-versus-delivery comparison details, multi-payment CIA and other-payment totals, expandable payment evidence, and evidence filters with counters in Payment Collections.',
    ],
  },
  {
    version: '2.0.84',
    releasedAt: '2026-08-02',
    title: 'Partial CIA payment evidence',
    changes: [
      'Classified an open buyer payment as Partial CIA only when its Salesforce received date is earlier than the STEM earliest ETA; equal, later, or unavailable ETA dates display Partial Payment.',
    ],
  },
  {
    version: '2.0.83',
    releasedAt: '2026-08-02',
    title: 'Clear payment evidence and STEM links',
    changes: [
      'Added the buyer payment amount beside its Salesforce received date in Payment Collections so partial-payment evidence is clear.',
      'Restricted STEM detail opening across operational tables to explicit links in STEM columns; clicking other row cells no longer opens STEM details.',
    ],
  },
  {
    version: '2.0.82',
    releasedAt: '2026-08-02',
    title: 'Payment promise amount entry',
    changes: [
      'Defaulted new Payment Collection promise amounts to the current receivable balance and removed the amount field increment and decrement controls.',
    ],
  },
  {
    version: '2.0.81',
    releasedAt: '2026-08-02',
    title: 'Calendar-safe MOPS month queries',
    changes: [
      'Corrected MOPS verification, SFS reporting, and Salesforce hedge finalization to use valid next-month date boundaries instead of assuming every month has 31 days.',
    ],
  },
  {
    version: '2.0.80',
    releasedAt: '2026-08-02',
    title: 'Manual MOPS verification evidence',
    changes: [
      'Changed final monthly MOPS verification to save the manually verified text without parsing or comparing its wording, month, or values.',
      'Made saved verification text viewable and editable from Markets while keeping revision, final-trading-day, complete-input, and audit controls.',
    ],
  },
  {
    version: '2.0.79',
    releasedAt: '2026-08-02',
    title: 'Final monthly MOPS verification',
    changes: [
      'Corrected paper-hedge expiry so daily MOPS rows must be complete but do not require individual verification.',
      'Added one controlled verification of the calculated final S380, S0.5, and SGO monthly averages against a manually pasted third-party message.',
      'Made changes to underlying daily MOPS values invalidate the monthly verification until the final average is verified again.',
      'Removed counterparty banking details and missing-bank warnings from payable FCBHK settlement documents; payment instructions come from the counterparty invoice.',
    ],
  },
  {
    version: '2.0.78',
    releasedAt: '2026-08-02',
    title: 'Hedge settlement payment direction',
    changes: [
      'Made every Hedge settlement document and screen state the payer, payee, beneficiary, and absolute settlement amount explicitly.',
      'Corrected payable FCBS credit notes so FCBS is the beneficiary and missing FCBS bank details never fall back to the FCBHK account.',
      'Renamed the Settlement invoice view to FCBHK Invoices and added payer-to-beneficiary information to every invoice row.',
      'Paper hedges now expire automatically only after the final Platts trading day and complete daily MOPS verification against manually pasted third-party messages.',
    ],
  },
  {
    version: '2.0.77',
    releasedAt: '2026-08-02',
    title: 'Unified AI settings, Markets, and Salesforce Special Terms',
    changes: [
      'Combined Dashboard AI Search and Hedge Desk Trading Assistant model selection and estimated USD usage in one AI Models settings tab.',
      'Moved Markets into a standalone Trading page available to every active user by default while retaining controlled market-price editing.',
      'Replaced Hedge settlement HTML-source editing with a rich-text editor and draggable settlement variables.',
      'Aligned the Hedge Desk theme, colors, spacing, and application shell behavior with the rest of FCOS.',
      'Moved Salesforce SWAPS synchronization to expired paper hedges with final-MOPS validation, server-calculated net P&L, one allocation per linked STEM, and an all-or-none previewed transaction.',
      'Added Salesforce-authoritative Special Terms wording and rule management with schema validation, stale-write protection, Salesforce-calculated priority, and controlled deletion.',
    ],
  },
  {
    version: '2.0.76',
    releasedAt: '2026-08-02',
    title: 'Graph mailbox registry enforcement',
    changes: [
      'Removed the obsolete environment-based mailbox import endpoint so every active sender address is managed only in the protected Graph mailbox registry.',
      'Extended the Graph-only regression guard to block environment-backed mailbox bootstrap compatibility from returning.',
    ],
  },
  {
    version: '2.0.75',
    releasedAt: '2026-08-02',
    title: 'Hedge Desk retirement and Graph-only email configuration',
    changes: [
      'Retired the standalone Hedge Desk deployment after a final source-to-FCOS reconciliation passed without record, relationship, document, or financial mismatches.',
      'Removed legacy SMTP credentials and channel-specific Microsoft configuration aliases from the active FCOS deployment.',
      'Made the shared Microsoft Graph application configuration and administrator-assigned mailbox registry the only FCOS email-delivery path.',
    ],
  },
  {
    version: '2.0.74',
    releasedAt: '2026-08-02',
    title: 'Native Hedge Desk and Graph-only email routing',
    changes: [
      'Added Hedge Desk to FCOS with physical trades, paper hedges, market prices, settlement, counterparties, month close, protected documents, and administration.',
      'Migrated and reconciled the existing Hedge Desk book, normalized relationships, settlement history, approved reports, and source audit attribution without recalculating closed history.',
      'Moved every FCOS email purpose to an administrator-managed Microsoft Graph mailbox route using Vercel OIDC, with no SMTP transport or automatic sender fallback.',
      'Added Hedge Desk maintenance, Salesforce integration controls, protected Trading Assistant model selection, System Health coverage, and idempotent delivery safeguards.',
    ],
  },
  {
    version: '2.0.73',
    releasedAt: '2026-08-02',
    title: 'Unofficial Compensation claim management',
    changes: [
      'Replaced the ambiguous Account Claim action with a Manage view that displays every existing open or closed Salesforce claim and its agreed amount.',
      'Separated the populated Account management view from the explicit Open New Claim flow.',
      'Restricted Salesforce compensation status changes to Finance, Administrators, and the active General Manager with server-side enforcement.',
    ],
  },
  {
    version: '2.0.72',
    releasedAt: '2026-08-02',
    title: 'Operational Microsoft Graph sender',
    changes: [
      'Moved payment reminders, reports, notifications, and other routine FCOS email to Microsoft Graph using Vercel OIDC and the operational mailbox.',
      'Added one Graph-first operational mail service with To, CC, BCC, plain-text, and HTML support across existing email workflows.',
      'Added a guarded temporary SMTP fallback for definite authentication failures while preventing automatic retries after uncertain Graph responses.',
      'Updated Email Senders and System Health to report the operational and FCOS Updates Microsoft 365 channels independently.',
    ],
  },
  {
    version: '2.0.71',
    releasedAt: '2026-08-02',
    title: 'Email sender configuration display',
    changes: [
      'Corrected the Email Senders settings response so both configured Vercel mailbox addresses are displayed.',
    ],
  },
  {
    version: '2.0.70',
    releasedAt: '2026-08-01',
    title: 'Email sender separation',
    changes: [
      'Separated the shared operational SMTP mailbox from the dedicated FCOS Updates sender throughout Settings.',
      'Added independent non-sending health checks for the operational SMTP and FCOS Updates delivery channels.',
      'Clarified that General Manager sending authority does not determine or change the FCOS Updates sender mailbox.',
    ],
  },
  {
    version: '2.0.69',
    releasedAt: '2026-08-01',
    title: 'Configurable General Manager',
    changes: [
      'Added General Manager as a protected user type that can be assigned to a successor in Users & Access.',
      'Made General Manager transfers atomic while retaining the UUID-backed authority role, reporting-root rules, and full administration access.',
      'Converted the former General Manager to Administrator and returned them to reporting-line setup after a confirmed transfer.',
    ],
  },
  {
    version: '2.0.68',
    releasedAt: '2026-08-01',
    title: 'General Manager reporting root',
    changes: [
      'Made the active UUID-backed General Manager the manager-free reporting hierarchy root while retaining manager eligibility for other employees.',
      'Added self-managed goal activation and evidence-backed outcomes for the General Manager without self-notifications.',
      'Added database enforcement against forged General Manager assignments and self-managed goal decisions.',
    ],
  },
  {
    version: '2.0.67',
    releasedAt: '2026-08-01',
    title: 'Settings methodology placement',
    changes: [
      'Moved each Settings methodology control from the section navigator into the active page header beside its primary actions.',
      'Removed the isolated mobile methodology row while retaining section-specific guidance for System Settings, Users & Access, and Audit Trail.',
    ],
  },
  {
    version: '2.0.66',
    releasedAt: '2026-08-01',
    title: 'Reporting-line batch save correction',
    changes: [
      'Corrected universal reporting-line saves so assignments are written directly to their validated final state without violating the manager constraint.',
      'Clearing both manager roles now removes the empty assignment record while retaining goal updates and audit history.',
    ],
  },
  {
    version: '2.0.65',
    releasedAt: '2026-08-01',
    title: 'Universal reporting-line save',
    changes: [
      'Replaced row-by-row reporting-line saves with one Save changes button that appears only when assignments are edited.',
      'Added atomic batch validation so revision conflicts or reporting cycles reject every edited assignment without partial saves.',
    ],
  },
  {
    version: '2.0.64',
    releasedAt: '2026-08-01',
    title: 'Reliable local sign-in',
    changes: [
      'Changed the default local development command to run the complete FCOS interface and server API together.',
      'Added visible authentication errors when FCOS cannot verify a signed-in Supabase account.',
    ],
  },
  {
    version: '2.0.63',
    releasedAt: '2026-08-01',
    title: 'Advisory Manager terminology',
    changes: [
      'Renamed the read-only secondary development role to Advisory Manager across Growth & Coaching and reporting-line administration.',
      'Clarified that Advisory Managers may view goals but cannot comment, approve, or complete them.',
    ],
  },
  {
    version: '2.0.62',
    releasedAt: '2026-08-01',
    title: 'Responsibility-based sidebar sections',
    changes: [
      'Focused Trading on Dashboard and Account Managers.',
      'Added Cross Functions for Payment Collections, disputes, unofficial compensation, and broker commissions.',
      'Added a dedicated Finance section for Cashflow while preserving each user\'s saved navigation preferences.',
    ],
  },
  {
    version: '2.0.61',
    releasedAt: '2026-08-01',
    title: 'Unofficial Compensation monitoring',
    changes: [
      'Added a Salesforce-authoritative Unofficial Compensation workspace grouped by exact Account, Contact, and currency.',
      'Added controlled Agreed Compensation claim, UOC recovery, group status, and erroneous-recovery actions with live validation and audit protection.',
      'Connected UOC opened dispute closures to exact-Account Agreed Compensation claims and blocked final closure when a required claim is missing.',
    ],
  },
  {
    version: '2.0.60',
    releasedAt: '2026-08-01',
    title: 'Page methodology guides',
    changes: [
      'Added page-specific Methodology dialogs across every authenticated FCOS workspace and application portal.',
      'Added tab-sensitive methodology for Payment Collections, Broker Commissions and Report Archive, and each Settings section.',
      'Documented data scope, calculations, priority rules, responsibilities, automatic behavior, and system boundaries in each guide.',
    ],
  },
  {
    version: '2.0.59',
    releasedAt: '2026-08-01',
    title: 'Personal navigation and payment collections',
    changes: [
      'Reorganized FCOS into Personal, Trading, and optional Tools sections with per-user ordering and visibility.',
      'Integrated Incoming Payments with the Payment Collections queue and added live Salesforce reconciliation exceptions.',
      'Added evidence-backed Payment Advice Received follow-up with reminder pausing and verification dates.',
      'Integrated Report Archive into Broker Commissions and moved Users & Access and Audit Trail into Settings.',
    ],
  },
  {
    version: '2.0.58',
    releasedAt: '2026-07-31',
    title: 'Coordinated work and development workflows',
    changes: [
      'Added My Commitments and actionable notification states across Projects & Tasks and Growth & Coaching.',
      'Added project followers, blocker links, blocked reasons, health updates, milestones, reusable checklists, and controlled bulk updates.',
      'Added goal-quality guidance, manager review filters, plan closeout and carry-forward, and private completed-task evidence links.',
      'Added staged coaching sessions, agenda carry-forward, action acceptance proposals, and on-demand loading of confidential session content.',
    ],
  },
  {
    version: '2.0.57',
    releasedAt: '2026-07-31',
    title: 'Simplified FCOS update email workflow',
    changes: [
      'Removed the separate submit, approval, and return steps so Administrators save drafts and only Vincent Lee can send the current saved revision.',
    ],
  },
  {
    version: '2.0.56',
    releasedAt: '2026-07-31',
    title: 'Direct Microsoft 365 update sender',
    changes: [
      'Changed FCOS Updates from delegated SMTP sending to passwordless Microsoft 365 OAuth, authenticated by the FCOS production workload and restricted to Vincent Lee\'s mailbox.',
    ],
  },
  {
    version: '2.0.55',
    releasedAt: '2026-07-31',
    title: 'FCOS Updates delivery protection',
    changes: [
      'Stopped an FCOS update email batch after the first Microsoft 365 sender-wide rejection, preventing repeated Send As failures from extending SMTP throttling and showing Administrators a clear recovery message.',
    ],
  },
  {
    version: '2.0.54',
    releasedAt: '2026-07-31',
    title: 'FCOS Updates sender identity',
    changes: [
      'Changed FCOS update announcements to use Vincent Lee <vincent@cosulich.com.hk> as their dedicated From identity without changing other FCOS email workflows.',
    ],
  },
  {
    version: '2.0.53',
    releasedAt: '2026-07-31',
    title: 'FCOS update email recipients',
    changes: [
      'Added a saved, editable recipient list and visible authenticated sender to the FCOS update email review workflow.',
    ],
  },
  {
    version: '2.0.52',
    releasedAt: '2026-07-31',
    title: 'Growth and coaching',
    changes: [
      'Added employee-authored measurable development goals with checkpoints, reporting-line approval, progress evidence, and completion review.',
      'Added confidential equal-participant coaching with mutual invitations, private preparation, shared session confirmation, actions, and private files.',
      'Added unified work notifications, controlled reminder emails, Outlook calendar synchronization states, and Administrator reporting-line setup.',
    ],
  },
  {
    version: '2.0.51',
    releasedAt: '2026-07-31',
    title: 'Admin-controlled FCOS update emails',
    changes: [
      'Added an Administrator release-review queue sourced from the Version Audit Trail, with editable categories and recipient-facing wording.',
      'Added Vincent-controlled approval, skip, restore, send, and recipient-level retry handling for individual updates and multi-update digests.',
      'Added service-only delivery tracking, shared authenticated SMTP sending, and FCOS Updates events in the Universal Audit Trail.',
    ],
  },
  {
    version: '2.0.50',
    releasedAt: '2026-07-31',
    title: 'Buyer report recipient persistence',
    changes: [
      'Corrected Louisa email address in the Outstanding Buyer Invoices report defaults and stored settings.',
      'Prevented Payment Reminder template saves from replacing unrelated scheduled report recipients.',
      'Made external reminder and scheduled report sending fail closed when shared settings storage is unavailable.',
    ],
  },
  {
    version: '2.0.49',
    releasedAt: '2026-07-31',
    title: 'Dashboard AI usage costs',
    changes: [
      'Added official standard USD token rates for every available Dashboard interpretation model.',
      'Added current-month and all-time estimated OpenAI API spend, interpretation counts, and last-use details to AI Search settings.',
      'Recorded successful OpenAI responses in a service-only usage ledger without storing search prompts or Salesforce data.',
    ],
  },
  {
    version: '2.0.48',
    releasedAt: '2026-07-31',
    title: 'Dashboard AI mobile verification fixes',
    changes: [
      'Prevented the mobile Dashboard results table from collapsing when analytics are hidden.',
      'Hardened all-history interpretation so generic STEM wording is not treated as an extra record condition.',
    ],
  },
  {
    version: '2.0.47',
    releasedAt: '2026-07-31',
    title: 'AI-powered Dashboard record search',
    changes: [
      'Added natural-language Dashboard search with clarification, visible interpretations, selected-period defaults, and explicit date overrides.',
      'Added server-validated Salesforce filters for parties, products, extra costs, operational fields, and financial comparisons without sending records to the AI model.',
      'Added an Administrator-controlled OpenAI model setting with GPT-5 mini as the recommended default.',
    ],
  },
  {
    version: '2.0.46',
    releasedAt: '2026-07-30',
    title: 'Projects and tasks collaboration',
    changes: [
      'Added shared Projects, Tasks, and one-level Subtasks with list and Kanban views, accountable assignment, priorities, due dates, and automatic progress.',
      'Added globally visible descriptions, comments, mentions, activity history, private related files, and in-app work notifications.',
      'Restricted assignment, movement, and archive actions to each item owner or General Manager while keeping collaboration visible to every active FCOS user.',
    ],
  },
  {
    version: '2.0.45',
    releasedAt: '2026-07-30',
    title: 'Universal application portal',
    changes: [
      'Added an entitled application hub after FCOS sign-in and an application switcher above Daily Work.',
      'Added audited EmailRouter Owner and Operator access management with automatic Administrator ownership.',
      'Added signed single-use launch, target-owned sessions, global logout, synchronization status, and retry handling.',
    ],
  },
  {
    version: '2.0.44',
    releasedAt: '2026-07-27',
    title: 'Product volume KPI in metric tonnes',
    changes: [
      'Normalized Product Volume KPI and Monthly Volume statistics to one MT unit before aggregation.',
      'Applied 0.98 MT per KL to HSFO and VLSFO, including CBM and litre source quantities.',
      'Applied 0.85 MT per KL to LSMGO and other products without changing any financial calculation.',
    ],
  },
  {
    version: '2.0.43',
    releasedAt: '2026-07-27',
    title: 'LSMGO volume statistics normalization',
    changes: [
      'Normalized LSMGO CBM and KL quantities to kilolitres in dashboard volume statistics.',
      'Converted LSMGO metric tonnes to approximate kilolitres using 1 KL = 0.85 MT.',
      'Kept the approximate density conversion out of pricing, cost, commission, and financial calculations.',
    ],
  },
  {
    version: '2.0.42',
    releasedAt: '2026-07-27',
    title: 'Dashboard litre volume normalization',
    changes: [
      'Read dashboard volume UOM from the Salesforce STEM line item or its Product record.',
      'Converted litres to kilolitres at 1 L = 0.001 KL before dashboard aggregation and display.',
      'Kept MT and KL totals separate in Product Volume and Monthly Volume instead of adding unlike units.',
    ],
  },
  {
    version: '2.0.41',
    releasedAt: '2026-07-24',
    title: 'Zero-balance accounting closure',
    changes: [
      'Allowed Finance to mark a zero-balance no-credit-note or no-recovery closure Not Required without entering a reason.',
      'Revalidated the latest Salesforce buyer receivable or exact supplier Account payable balance before applying the exception.',
      'Kept explanations mandatory for credit notes, supplier recoveries, legacy financial actions, and supplier invoice instructions.',
    ],
  },
  {
    version: '2.0.40',
    releasedAt: '2026-07-24',
    title: 'Balance-aware dispute closure defaults',
    changes: [
      'Prefilled No Balance Payment for supplier no-recovery closure when the selected supplier payable balance is zero.',
      'Prefilled Full payment received from buyer for buyer and supplier closure when the buyer receivable balance is zero.',
      'Kept both defaults editable and avoided treating missing Salesforce balances as zero.',
    ],
  },
  {
    version: '2.0.39',
    releasedAt: '2026-07-24',
    title: 'Dispute commercial outcome clarity',
    changes: [
      'Restored supplier no-recovery closure and replaced internal party-selection wording with clear disputed-party badges.',
      'Separated trader commercial outcomes from Finance settlement evidence so credit-note and recovery amounts are entered only once.',
      'Made supplier currency invoice-derived and rebuilt Financial Exposure so every supplier invoice column remains accessible.',
    ],
  },
  {
    version: '2.0.38',
    releasedAt: '2026-07-24',
    title: 'Paid supplier invoice dispute automation',
    changes: [
      'Added one supplier dispute amount with editable oldest-invoice-first allocation into Do not pay and Get back paid amount instructions.',
      'Added urgent pre-approval Finance holds, invoice-level refund or offset settlement, evidence controls, and exact Account and currency validation.',
      'Added automatic post-approval payment reconciliation without changing the approved dispute total or Dispute P&L.',
    ],
  },
  {
    version: '2.0.37',
    releasedAt: '2026-07-24',
    title: 'Salesforce dispute closure synchronization',
    changes: [
      'Made a Closed Salesforce dispute status authoritative in the queue while preserving the internal FCOS workflow stage.',
      'Showed directly closed cases as read-only, with their prior approval, accounting, action, document, and settlement history intact.',
      'Added a final Salesforce conflict check so FCOS cannot overwrite a newly closed dispute with an active workflow status.',
    ],
  },
  {
    version: '2.0.36',
    releasedAt: '2026-07-24',
    title: 'Buyer dispute UOC closure',
    changes: [
      'Added UOC opened as a Close dispute with buyer reason.',
      'Applied the shared buyer close-reason list to the user interface and server validation.',
      'Clarified that the balance payment instruction remains specific to supplier closure.',
    ],
  },
  {
    version: '2.0.35',
    releasedAt: '2026-07-24',
    title: 'Supplier dispute UOC closure',
    changes: [
      'Added UOC opened as a Close dispute with supplier reason.',
      'Applied the same supplier close-reason list to the user interface and server validation.',
      'Updated the Dispute Workflow Rules modal while retaining the required balance payment instruction.',
    ],
  },
  {
    version: '2.0.34',
    releasedAt: '2026-07-24',
    title: 'Potential Delay line-product eligibility',
    changes: [
      'Excluded STEMs without an uncancelled STEM line product item from the Potential Delay exception.',
      'Kept missing-invoice and negative-profit checks independent for those STEMs.',
      'Displayed the active line-product requirement in the Exception Review queue methodology.',
    ],
  },
  {
    version: '2.0.33',
    releasedAt: '2026-07-24',
    title: 'Exception Review Schedule ranges',
    changes: [
      'Replaced Expected Delivery Date throughout Exception Review with the selected Salesforce ETA or ETB Schedule range.',
      'Used the Hong Kong STEM creation date for PROMPT or missing Schedule dates, including period selection and Potential Delay.',
      'Updated Exception Review date filtering, display, search, methodology, and CSV export to use one consistent Schedule rule.',
    ],
  },
  {
    version: '2.0.32',
    releasedAt: '2026-07-24',
    title: 'Exception Review port-country search',
    changes: [
      'Extended Exception Review search to match the Salesforce port name and its country.',
      'Added port identity to the Exception Review data response without changing the existing search workflow.',
    ],
  },
  {
    version: '2.0.31',
    releasedAt: '2026-07-23',
    title: 'Payment reminder button states',
    changes: [
      'Changed payment reminders sent today to a blue tick button.',
      'Kept blocked payment reminders as disabled blue-cross buttons that cannot open STEM details.',
    ],
  },
  {
    version: '2.0.30',
    releasedAt: '2026-07-23',
    title: 'CL Key required for reminder rules',
    changes: [
      'Filtered Accounts without a Salesforce CL Key out of Reminder Rules.',
      'Applied the same CL Key requirement to GROUP child totals and server-side save revalidation.',
    ],
  },
  {
    version: '2.0.29',
    releasedAt: '2026-07-23',
    title: 'Eligible GROUP child counts',
    changes: [
      'Limited Reminder Rules direct-child totals to active Buyer, Buyer & Supplier, and GROUP Accounts.',
      'Excluded inactive, pure Supplier, and Broker Accounts from displayed counts and reminder propagation.',
    ],
  },
  {
    version: '2.0.28',
    releasedAt: '2026-07-23',
    title: 'Active GROUP child counts',
    changes: [
      'Excluded inactive Salesforce Accounts from Reminder Rules direct-child totals.',
      'Continued counting active direct children across Account types while keeping reminder propagation limited to eligible Buyer Accounts.',
    ],
  },
  {
    version: '2.0.27',
    releasedAt: '2026-07-23',
    title: 'Account identity and GROUP counts',
    changes: [
      'Replaced Salesforce Account ID suffixes with authoritative CL Keys in searchable Account views.',
      'Changed Reminder Rules GROUP counts to include every direct Salesforce child while keeping rule propagation limited to active eligible children.',
      'Added CL Key search and display to Reminder Rules and Account Managers, including parent GROUP references.',
    ],
  },
  {
    version: '2.0.26',
    releasedAt: '2026-07-23',
    title: 'Buyer payment reminder rules',
    changes: [
      'Added Account-ID reminder rules for active Buyer, Buyer & Supplier, and GROUP Accounts.',
      'Added continuous GROUP inheritance, direct child overrides, notes, attribution, and revision protection.',
      'Blocked external reminders for restricted not-yet-overdue invoices while preserving broker-only routing and internal reports.',
    ],
  },
  {
    version: '2.0.25',
    releasedAt: '2026-07-22',
    title: 'Selectable GROUP update scope',
    changes: [
      'Added GROUP-only and GROUP-and-children choices when editing Account managers.',
      'Added the same explicit scope choices for Account notes, with atomic child-note replacement.',
      'Updated Account Managers methodology and row feedback to explain inheritance, Salesforce writes, and copied notes.',
    ],
  },
  {
    version: '2.0.24',
    releasedAt: '2026-07-22',
    title: 'Account notes and GROUP-first directory',
    changes: [
      'Moved active GROUP Accounts to the top of the Account Managers directory.',
      'Added independent 255-character Account notes with inline editing, attribution, and note-aware search.',
      'Kept child Account notes separate from GROUP manager propagation and Salesforce synchronization.',
    ],
  },
  {
    version: '2.0.23',
    releasedAt: '2026-07-22',
    title: 'Account manager priority and GROUP coverage',
    changes: [
      'Added drag-and-drop manager priority with stable unsaved rows for second and third assignments.',
      'Added GROUP Account confirmation, child-account propagation, inherited assignments, and group-aware search.',
      'Added an Account Managers methodology guide beside Refresh.',
    ],
  },
  {
    version: '2.0.22',
    releasedAt: '2026-07-22',
    title: 'Account Manager administration',
    changes: [
      'Replaced Buyers Administrator with Account Managers for active Buyer, Buyer & Supplier, and Broker Account names.',
      'Added responsive inline zero-to-three manager editing, manager-name filters, Salesforce synchronization, and explicit Save and Cancel controls.',
      'Expanded legacy manager initials in Salesforce, replaced Sam Yip with Vincent Lee, and seeded the active assignments in FCOS.',
    ],
  },
  {
    version: '2.0.21',
    releasedAt: '2026-07-22',
    title: 'Explicit buyer trader selection',
    changes: [
      'Changed Add Trader to open an empty selection instead of automatically choosing the first active user.',
      'Disabled assignment saving until every added trader slot contains a deliberately selected active FCOS user.',
      'Kept zero-trader saves available when no assignment rows have been added.',
    ],
  },
  {
    version: '2.0.20',
    releasedAt: '2026-07-22',
    title: 'Complete buyer directory pagination',
    changes: [
      'Changed Buyers Administrator to fetch the complete Salesforce buyer Account set without the 2,000-row aggregate ceiling.',
      'Paginated the buyer table at 100 rows per page for faster rendering and easier navigation.',
      'Focused the directory columns on buyer identity, trader ownership, update history, and management actions.',
    ],
  },
  {
    version: '2.0.19',
    releasedAt: '2026-07-22',
    title: 'Buyer trader administration',
    changes: [
      'Added a Buyers Administrator page for assigning zero to three internal traders to each Salesforce buyer Account.',
      'Kept same-name buyer Accounts separate by Salesforce Account ID and revalidated buyer usage before every save.',
      'Added atomic assignment saves, active-user checks, edit-conflict protection, and administrator audit events.',
    ],
  },
  {
    version: '2.0.18',
    releasedAt: '2026-07-16',
    title: 'Sidebar display modes',
    changes: [
      'Restored the left-edge hover rail as the default auto-hide sidebar mode.',
      'Changed the arrow control to pin or unpin the sidebar with page space reserved while pinned.',
      'Persisted the selected auto-hide or fixed sidebar mode across browser sessions.',
    ],
  },
  {
    version: '2.0.17',
    releasedAt: '2026-07-16',
    title: 'Explicit sidebar visibility',
    changes: [
      'Added a sidebar header control that completely hides the navigation drawer and its edge rail.',
      'Added a compact top-left arrow to restore the sidebar when it is hidden.',
      'Persisted the sidebar visibility preference across browser sessions.',
    ],
  },
  {
    version: '2.0.16',
    releasedAt: '2026-07-16',
    title: 'Consolidated payment reminder batches',
    changes: [
      'Grouped payment reminder batches by buyer Account ID, buyer broker Account IDs, and broker routing mode.',
      'Merged and deduplicated invoice-specific trader and collection-handler recipients within each buyer and broker group.',
      'Kept different buyer Accounts, broker Accounts, and routing instructions in separate email batches.',
    ],
  },
  {
    version: '2.0.15',
    releasedAt: '2026-07-15',
    title: 'Monthly gross margin trends',
    changes: [
      'Added monthly Gross Margin % to the Gross Profit trend with a dedicated percentage axis.',
      'Added the same Gross Margin % trend to the stacked monthly product-volume chart.',
      'Calculated each monthly margin from the matching monthly Gross Profit and Turnover totals.',
    ],
  },
  {
    version: '2.0.14',
    releasedAt: '2026-07-15',
    title: 'Correct buyer invoice due dates',
    changes: [
      'Corrected buyer invoice payment-term dates to count the delivery date as day one.',
      'Applied the corrected due date consistently to invoice lists, reminders, cashflow, incoming payments, late-interest calculations, and stem details.',
    ],
  },
  {
    version: '2.0.13',
    releasedAt: '2026-07-13',
    title: 'Faster dispute draft saves',
    changes: [
      'Updated only the active dispute queue row after Save Draft instead of reloading the full Salesforce queue.',
      'Parallelized independent Salesforce and Supabase draft checks while preserving party revalidation and status writeback.',
      'Refreshed the current case audit trail directly from the save response.',
    ],
  },
  {
    version: '2.0.12',
    releasedAt: '2026-07-10',
    title: 'Focused dispute queue products',
    changes: [
      'Excluded Transport, Undercharge, and Adjustment extra-cost categories from the Dispute Workflow queue.',
      'Removed quantities from extra-cost product labels while retaining quantities for normal STEM product line items.',
    ],
  },
  {
    version: '2.0.11',
    releasedAt: '2026-07-10',
    title: 'Extra-cost products in dispute queue',
    changes: [
      'Added STEM extra-cost product names and quantities to the Dispute Workflow queue product column.',
      'Matched invoiced extra-cost products to their supplier invoice due-date rows.',
      'Kept uninvoiced extra-cost products visible with their supplier details.',
    ],
  },
  {
    version: '2.0.10',
    releasedAt: '2026-07-10',
    title: 'Dispute dates and document drop zone',
    changes: [
      'Removed Salesforce Account IDs from the user-facing dispute workflow while retaining Account-ID validation internally.',
      'Added drag-and-drop document selection to the Salesforce dispute document upload modal.',
      'Added delivery, buyer payment due, and supplier payment due dates to the workflow header and financial exposure section.',
    ],
  },
  {
    version: '2.0.9',
    releasedAt: '2026-07-10',
    title: 'Supabase-owned dispute parties',
    changes: [
      'Moved disputed Account selection and workflow instructions into Supabase without using the Salesforce Dispute object.',
      'Included buyer, line-item supplier, and extra-cost supplier Accounts, including cancelled sources, with Account-ID deduplication.',
      'Added account-first Salesforce document uploads with editable date-and-direction names and automatic duplicate suffixes.',
    ],
  },
  {
    version: '2.0.8',
    releasedAt: '2026-07-10',
    title: 'Dispute document upload access',
    changes: [
      'Added a visible party-aware document upload control inside the Manage Dispute Workflow modal.',
      'Made document upload save new trader actions automatically before opening the Salesforce upload form.',
      'Limited supplier Account ID suffixes to same-name supplier collisions instead of showing them on every queue row.',
    ],
  },
  {
    version: '2.0.7',
    releasedAt: '2026-07-10',
    title: 'Account-ID dispute parties',
    changes: [
      'Changed dispute buyer and supplier identity to Salesforce Account IDs, including separate handling for same-name supplier accounts.',
      'Added Salesforce structure validation using STEM line-item Original Supplier lookups and blocked extra-cost-only or inconsistent dispute parties.',
      'Made workflow actions and documents party-aware, with server-derived writeback targets and multi-record Salesforce document links.',
    ],
  },
  {
    version: '2.0.6',
    releasedAt: '2026-07-10',
    title: 'Shared external reminder sender',
    changes: [
      'Changed External Payment Reminders to use one centrally managed server SMTP sender for every user.',
      'Removed browser-specific External Payment Reminder credentials and ignored legacy per-user SMTP overrides in the API.',
      'Added automatic cleanup of previously stored browser reminder credentials and settings drafts.',
    ],
  },
  {
    version: '2.0.5',
    releasedAt: '2026-07-10',
    title: 'External reminder sender fallback',
    changes: [
      'Changed blank External Payment Reminder From Email settings to use the authenticated SMTP username instead of the shared info mailbox.',
      'Added a safe Microsoft 365 Send As fallback that retries from the authenticated mailbox only after a confirmed SendAsDenied rejection.',
      'Replaced long Microsoft SMTP diagnostics with a concise sender-permission message when the authenticated mailbox is also rejected.',
    ],
  },
  {
    version: '2.0.4',
    releasedAt: '2026-07-10',
    title: 'Dispute collaboration and settlement',
    changes: [
      'Redesigned the dispute lifecycle around trader preparation, approval, accounting settlement, and guarded final closure.',
      'Added Salesforce-first dispute document uploads with party-aware smart filenames, evidence checks, and in-app preview.',
      'Added visible workflow rules for every role while keeping approval and accounting actions permission-controlled.',
    ],
  },
  {
    version: '2.0.3',
    releasedAt: '2026-07-10',
    title: 'Dispute Workflow wording',
    changes: [
      'Removed preview wording from the Dispute Workflow page, audit labels, release notes, and workflow messages.',
      'Made /disputes the canonical Dispute Workflow route while redirecting legacy dispute links.',
      'Added Dispute Workflow API aliases while keeping the old endpoints available for compatibility.',
    ],
  },
  {
    version: '2.0.2',
    releasedAt: '2026-07-09',
    title: 'Dispute workflow cleanup',
    changes: [
      'Removed the retired Dispute Management page from navigation and routed old dispute links to Dispute Workflow.',
      'Removed old-only dispute document mutation and party-edit endpoints while keeping Dispute Workflow APIs unchanged.',
      'Changed the disputes access module label and path to Dispute Workflow.',
    ],
  },
  {
    version: '2.0.1',
    releasedAt: '2026-07-09',
    title: 'V2 version sequence',
    changes: [
      'Started the next release sequence at V2.0.1 for FCOS releases going forward.',
      'Kept the existing version audit trail visible for reference.',
    ],
  },
  {
    version: '1.0.60',
    releasedAt: '2026-07-09',
    title: 'FCOS custom domain',
    changes: [
      'Changed generated app links and scheduled report endpoints to fcos.fcuno.com.',
      'Attached and verified the fcos.fcuno.com custom domain in Vercel.',
      'Prepared the old deployment aliases for removal after custom-domain verification.',
    ],
  },
  {
    version: '1.0.59',
    releasedAt: '2026-07-09',
    title: 'FCOS production domain',
    changes: [
      'Changed the production app identity and generated report links to FCOS.',
      'Renamed internal app storage, autosave, and event prefixes to FCOS.',
      'Updated package metadata, documentation, and server fallback URLs to the FCOS app identity.',
    ],
  },
  {
    version: '1.0.58',
    releasedAt: '2026-07-09',
    title: 'FCOS shell branding',
    changes: [
      'Renamed the app brand to FCOS across the browser title, manifest, login screen, sidebar, favicon label, and XLS report metadata.',
      'Changed the sidebar into an auto-hide left-edge drawer so the pages use the full browser width by default.',
      'Removed the workspace header banner and moved the Salesforce connection status into the sidebar header.',
    ],
  },
  {
    version: '1.0.57',
    releasedAt: '2026-07-09',
    title: 'Single workspace routing',
    changes: [
      'Removed the old workspace shell and made the current interface the only active app surface.',
      'Redirected legacy workspace URLs to canonical routes so existing bookmarks continue to open.',
      'Removed visible workspace switching labels from navigation and version dialogs.',
    ],
  },
  {
    version: '1.0.56',
    releasedAt: '2026-07-09',
    title: 'Browser document scroll lock',
    changes: [
      'Locked the browser document to the viewport so app pages cannot scroll into blank space.',
      'Kept scrolling inside the app layouts and route-owned table areas.',
    ],
  },
  {
    version: '1.0.55',
    releasedAt: '2026-07-09',
    title: 'Dispute workflow outer scroll lock',
    changes: [
      'Stopped the Dispute Workflow route from using the outer workspace scroll container.',
      'Made Dispute Workflow fill its route area exactly so only the queue table scrolls.',
      'Applied the same route-level scroll containment to the Dispute Workflow entry point.',
    ],
  },
  {
    version: '1.0.54',
    releasedAt: '2026-07-09',
    title: 'Dispute workflow page scroll containment',
    changes: [
      'Changed Dispute Workflow to a viewport-contained layout so the page itself does not keep scrolling.',
      'Moved scrolling responsibility to the Dispute Workflow Queue table area only.',
    ],
  },
  {
    version: '1.0.53',
    releasedAt: '2026-07-09',
    title: 'Dispute workflow modal scroll fix',
    changes: [
      'Constrained the Dispute Workflow manage modal to the browser height.',
      'Pinned the modal header, summary, and footer while limiting scrolling to the modal body.',
    ],
  },
  {
    version: '1.0.52',
    releasedAt: '2026-07-09',
    title: 'Dispute queue delivery date cutoff',
    changes: [
      'Hardcoded Dispute Management queue to exclude STEMs with Delivery Date before 1 Jan 2026.',
      'Applied the same hardcoded Delivery Date cutoff to Dispute Workflow queue while keeping blank delivery-date STEMs visible.',
    ],
  },
  {
    version: '1.0.51',
    releasedAt: '2026-07-09',
    title: 'Cashflow forecast methodology sheet',
    changes: [
      'Added a Methodology button to Cashflow Forecast next to Refresh.',
      'Added a floating explanation sheet covering buyer receipt prediction, supplier payment assumptions, business-day adjustment, holiday handling, and forecast limitations.',
    ],
  },
  {
    version: '1.0.50',
    releasedAt: '2026-07-09',
    title: 'Workspace shell',
    changes: [
      'Added unified navigation, simplified module names, and a cleaner operational layout.',
      'Applied page header, table, card, and control styling without changing Salesforce calculations or API payloads.',
      'Kept route compatibility while the workspace design was introduced.',
    ],
  },
  {
    version: '1.0.49',
    releasedAt: '2026-07-09',
    title: 'Payable remittance payment filter',
    changes: [
      'Excluded Payment__c Payable Remittance records from Incoming Payment receivable rows.',
      'Applied the same remittance filter to Stem Detail Payment from Buyer rows so payable remittance aggregates are not shown as buyer receipts.',
    ],
  },
  {
    version: '1.0.48',
    releasedAt: '2026-07-09',
    title: 'Salesforce OAuth configuration guard',
    changes: [
      'Blocked silent fallback to expired temporary Salesforce access tokens when durable OAuth variables are present but blank.',
      'Updated System Health to report blank Salesforce OAuth variables as a configuration error.',
    ],
  },
  {
    version: '1.0.47',
    releasedAt: '2026-07-09',
    title: 'Durable Salesforce authentication',
    changes: [
      'Added Salesforce OAuth JWT bearer authentication as the preferred permanent server-to-server auth mode.',
      'Updated System Health to show JWT bearer, refresh-token, or temporary access-token mode with expiry-risk notes.',
    ],
  },
  {
    version: '1.0.46',
    releasedAt: '2026-07-09',
    title: 'Receivable remittance payment filter',
    changes: [
      'Expanded Payment__c receivable-remittance detection beyond record type so remittance rows are not shown as buyer payments.',
      'Applied the same filter to Incoming Payment, Stem Detail payment dates, cashflow payment samples, and late-payment interest calculations.',
    ],
  },
  {
    version: '1.0.45',
    releasedAt: '2026-07-09',
    title: 'Incoming payment email KPI cards',
    changes: [
      'Updated the Incoming Payment report email summary to use the same card-style KPI layout as the Outstanding Buyer Invoices email.',
      'Added matching plain-text summary lines for email clients that do not render HTML.',
    ],
  },
  {
    version: '1.0.44',
    releasedAt: '2026-07-09',
    title: 'Rich text email templates',
    changes: [
      'Converted all email content editors to rich text format.',
      'Preserved rich HTML for outgoing internal reports, external reminders, incoming payment reports, and late payment interest request emails.',
    ],
  },
  {
    version: '1.0.43',
    releasedAt: '2026-07-09',
    title: 'Payment column alignment',
    changes: [
      'Right-aligned Terms and Delay in Receivable Payments.',
      'Right-aligned Overdue values in Outstanding Buyer Invoices, reminder previews, and related email tables.',
    ],
  },
  {
    version: '1.0.42',
    releasedAt: '2026-07-09',
    title: 'Interoffice data restriction',
    changes: [
      'Added the Interoffice user type with operational finance access and no default Settings, Admin, or Reports Archive access.',
      'Applied server-side exclusion of FRATELLI COSULICH buyer-group STEMs to dashboard KPIs, charts, tables, invoice reports, incoming payments, cashflow, disputes, broker commissions, and stem detail access.',
    ],
  },
  {
    version: '1.0.41',
    releasedAt: '2026-07-09',
    title: 'Payment table email alignment',
    changes: [
      'Left-aligned Delay and Overdue values and removed the Days suffix from Overdue column displays.',
      'Updated Incoming Payment report emails to use the current Receivable Payments table order while excluding only the Interest Invoice action column.',
    ],
  },
  {
    version: '1.0.40',
    releasedAt: '2026-07-09',
    title: 'Settings system health',
    changes: [
      'Added a System Health tab inside Settings to show Salesforce, Supabase, Google Drive, exchange-rate, holiday, SMTP, Vercel, and browser sender status.',
      'Added redacted server-side health checks with token expiry notes where providers expose them.',
      'Separated server SMTP status from browser-local Internal and External Payment Reminder sender configuration.',
    ],
  },
  {
    version: '1.0.39',
    releasedAt: '2026-07-09',
    title: 'Universal audit trail and receivable table cleanup',
    changes: [
      'Added an administrator-only Universal Audit Trail page covering admin changes, collection events, report archive actions, dispute workflow events, internal report runs, and late payment interest requests.',
      'Allowed late payment interest invoice requests to be sent again after user confirmation.',
      'Removed the Receivable Payments Status column, tightened Terms and Delay columns, and removed the Days suffix from Delay values.',
    ],
  },
  {
    version: '1.0.38',
    releasedAt: '2026-07-08',
    title: 'Cashflow forecast date floor',
    changes: [
      'Excluded buyer payment performance before 1 Jan 2026 from Cashflow Forecast modelling.',
      'Excluded receivable and payable forecast rows for STEMs delivered before 1 Jan 2026.',
    ],
  },
  {
    version: '1.0.37',
    releasedAt: '2026-07-08',
    title: 'Internal report footer alignment',
    changes: [
      'Moved the Outstanding Buyer Invoices internal daily report template controls immediately to the left of Close.',
    ],
  },
  {
    version: '1.0.36',
    releasedAt: '2026-07-08',
    title: 'Cashflow forecast',
    changes: [
      'Added Cashflow Forecast with buyer receipt prediction, supplier payment outflows, and daily/weekly/monthly buckets.',
      'Added Nager.Date holiday blocking with cache and manual blocked-date overrides for weekend, Singapore, and US holiday adjustments.',
    ],
  },
  {
    version: '1.0.35',
    releasedAt: '2026-07-08',
    title: 'Late payment STEM link token',
    changes: [
      'Added a Link to STEM variable for late payment interest request email templates.',
      'Linked late payment interest request emails back to Incoming Payment with the relevant STEM detail opened.',
    ],
  },
  {
    version: '1.0.34',
    releasedAt: '2026-07-08',
    title: 'Email modal workflow alignment',
    changes: [
      'Moved external payment reminder template actions to the footer immediately before Close.',
      'Redesigned the Incoming Payment report email modal into the same step workflow used by external payment reminders.',
    ],
  },
  {
    version: '1.0.33',
    releasedAt: '2026-07-08',
    title: 'Remove report builder and data explorer',
    changes: [
      'Removed Report Builder and Data Explorer routes, navigation items, access modules, and unused page/component code.',
      'Renamed Stem P&L Report to Dashboard and Qlik Validator Tool across navigation and page headings.',
    ],
  },
  {
    version: '1.0.32',
    releasedAt: '2026-07-08',
    title: 'External payment reminder modal redesign',
    changes: [
      'Redesigned the external payment reminder modal into a three-step workflow for invoice selection, recipient review, and email preview.',
      'Simplified reminder wording and changed the modal to a neutral solid style with status-only color accents.',
    ],
  },
  {
    version: '1.0.31',
    releasedAt: '2026-07-08',
    title: 'Exclude receivable remittance from payments',
    changes: [
      'Excluded Payment__c records with Receivable Remittance record type from Incoming Payment receivable payment rows.',
      'Applied the same exclusion to Stem Detail buyer payment dates and late-payment interest calculation inputs.',
    ],
  },
  {
    version: '1.0.30',
    releasedAt: '2026-07-08',
    title: 'Incoming payment bank charge grouping',
    changes: [
      'Restored bank-charge grouping for small same-STEM payments that are not explicitly labelled as bank charges in Salesforce.',
      'Attached inferred bank charges underneath the related larger buyer payment amount instead of showing them as separate receivable payment rows.',
    ],
  },
  {
    version: '1.0.29',
    releasedAt: '2026-07-08',
    title: 'Incoming payment payable exclusion',
    changes: [
      'Excluded STEM payable-calculation rows from the Incoming Payment Receivable Payments table.',
      'Reused the same payable amount guard from Stem Detail so calculated supplier/payable amounts are not treated as receivable payments.',
    ],
  },
  {
    version: '1.0.28',
    releasedAt: '2026-07-08',
    title: 'Stem detail payment labels and payable exclusion',
    changes: [
      'Renamed Stem Detail payment sections to Payment from Buyer, Supplier Side, and Payment to Supplier.',
      'Strengthened Stem Detail payment classification so calculated payable rows are excluded from buyer payment dates.',
    ],
  },
  {
    version: '1.0.27',
    releasedAt: '2026-07-08',
    title: 'Stem detail buyer receipt classification',
    changes: [
      'Stopped Stem Detail from showing STEM-linked calculated payable amounts as buyer invoice received dates.',
      'Added a payable-amount guard so undelivered STEM supplier cost calculations are not treated as buyer receipts.',
    ],
  },
  {
    version: '1.0.26',
    releasedAt: '2026-07-08',
    title: 'Incoming payment empty table behavior',
    changes: [
      'Removed data-table column headers from empty Buyer CIA Invoices and Available Buyer Balances sections.',
      'Changed both empty sections to use compact one-row empty messages instead of tall table empty states.',
    ],
  },
  {
    version: '1.0.25',
    releasedAt: '2026-07-08',
    title: 'Available buyer balances table height behavior',
    changes: [
      'Changed Incoming Payment Available Buyer Balances table to auto-fit up to five records.',
      'Enabled scrolling for the Available Buyer Balances table only when more than five records are visible.',
    ],
  },
  {
    version: '1.0.24',
    releasedAt: '2026-07-08',
    title: 'Buyer CIA table height behavior',
    changes: [
      'Changed Incoming Payment Buyer CIA Invoices table to auto-fit up to five visible records.',
      'Enabled scrolling for the Buyer CIA Invoices table only when more than five records are visible.',
    ],
  },
  {
    version: '1.0.23',
    releasedAt: '2026-07-08',
    title: 'Late payment interest link styling',
    changes: [
      'Renamed the incoming payment report hyperlink button to Late Payment Interest Invoice.',
      'Changed the hyperlink button background to Ferrari red.',
    ],
  },
  {
    version: '1.0.22',
    releasedAt: '2026-07-08',
    title: 'Reminder template variable drag-and-drop',
    changes: [
      'Replaced the Insert invoice table button in External payment reminder with the draggable invoice table variable.',
      'Allowed payment reminder variables to be dragged into the email content editor while editing the template.',
    ],
  },
  {
    version: '1.0.21',
    releasedAt: '2026-07-08',
    title: 'External reminder preview cleanup',
    changes: [
      'Changed the payment reminder modal title to External payment reminder.',
      'Improved Buyer-only routing badge color and alignment in related invoice selection.',
      'Added saved CC and BCC template fields while keeping To as final review-only routing.',
      'Changed the reminder preview to show actual To, Cc, Bcc, Subject, and selected invoice rows.',
    ],
  },
  {
    version: '1.0.20',
    releasedAt: '2026-07-08',
    title: 'Settings email sender tabs',
    changes: [
      'Changed Settings > Email Senders to use separate tabs for Internal and External Payment Reminder SMTP accounts.',
      'Preserved the existing Save All Settings and autosaved draft behavior for both sender accounts.',
    ],
  },
  {
    version: '1.0.19',
    releasedAt: '2026-07-08',
    title: 'Email template cleanup',
    changes: [
      'Removed the duplicate Payment Reminder Template button from Outstanding Buyer Invoices.',
      'Renamed the internal report action to Outstanding Buyer Invoices - Internal Daily Report.',
      'Fixed the internal daily report modal layout so footer actions remain visible.',
      'Added editable To, Cc, and Bcc fields to the Late Payment Interest Request email template.',
    ],
  },
  {
    version: '1.0.18',
    releasedAt: '2026-07-08',
    title: 'SMTP-only email delivery',
    changes: [
      'Removed the third-party API delivery path from server email sending.',
      'Changed all internal, external reminder, scheduled report, and late payment interest emails to use SMTP only.',
      'Updated email configuration messages to point users to saved SMTP senders or Vercel SMTP environment variables.',
    ],
  },
  {
    version: '1.0.17',
    releasedAt: '2026-07-08',
    title: 'Email reminder workflow refinement',
    changes: [
      'Added Payment Collection Handler to the Outstanding Buyer Invoices internal email reminder table and plain-text output.',
      'Changed late payment interest requests to fall back to the system-wide SMTP sender when no Internal browser SMTP sender is saved.',
      'Redesigned the external payment reminder modal so related invoice selection remains on top and email review/preview are split side by side.',
      'Added explicit edit, save, and cancel template controls inside the external payment reminder modal.',
    ],
  },
  {
    version: '1.0.16',
    releasedAt: '2026-07-08',
    title: 'Email template preview alignment',
    changes: [
      'Renamed Email Sender settings to Internal and External Payment Reminder.',
      'Added an editable Late Payment Interest Request email template with sample preview in Incoming Payment.',
      'Changed late payment interest requests to use the saved Internal sender only.',
      'Reworked the Outstanding Buyer Invoices internal reminder into a modal with editable settings, generated preview, save/cancel, and send controls.',
      'Added Save Template inside manual payment reminder preview so edited reminder content can be reused.',
    ],
  },
  {
    version: '1.0.15',
    releasedAt: '2026-07-08',
    title: 'Late payment interest calculation',
    changes: [
      'Changed late payment interest request emails to send to Louisa and the requesting user.',
      'Added buyer account interest-rate lookup for late payment interest calculation.',
      'Added partial-payment interest calculation details and formula to the request email.',
    ],
  },
  {
    version: '1.0.14',
    releasedAt: '2026-07-08',
    title: 'Incoming payment report action link',
    changes: [
      'Added a Request Late Payment Interest Invoice email template token for Incoming Payment reports.',
      'Rendered the token as a captioned hyperlink to the Incoming Payment page with the report date and keyword filters applied.',
      'Preserved email-link query filters through login before opening Incoming Payment.',
    ],
  },
  {
    version: '1.0.13',
    releasedAt: '2026-07-08',
    title: 'Notification close fix',
    changes: [
      'Fixed notification close buttons so dismissed toasts are removed immediately instead of staying visible.',
      'Made the toast container non-interactive except for the notification itself so no overlay blocks the close button.',
    ],
  },
  {
    version: '1.0.12',
    releasedAt: '2026-07-08',
    title: 'Incoming payment notification fixes',
    changes: [
      'Changed late payment interest requests to require a saved SMTP sender instead of falling through to missing server email configuration.',
      'Improved the missing sender message so users know to configure Settings > Email Senders.',
      'Raised the notification layer and made toast close buttons always visible and clickable.',
    ],
  },
  {
    version: '1.0.11',
    releasedAt: '2026-07-08',
    title: 'Incoming payment interest request workflow',
    changes: [
      'Matched Inserted On payment date styling with the bank charge amber treatment on screen and in email tables.',
      'Added Incoming Payment KPI variables as draggable email template tokens.',
      'Added a late payment interest invoice request button for buyer payments delayed more than 3 days.',
      'Recorded each interest invoice request in Supabase so requested buttons stay disabled after refresh.',
    ],
  },
  {
    version: '1.0.10',
    releasedAt: '2026-07-08',
    title: 'Incoming payment created-date filters',
    changes: [
      'Changed Incoming Payment filters to use Payment CreatedDate on a Hong Kong date basis.',
      'Added Inserted On details below Received Date when the created date differs from the received date.',
      'Widened the Incoming Payment email preview while keeping the template editor fixed-width.',
      'Reworked the Incoming Payment email template editor with drag-and-drop table tokens plus explicit edit, save, and cancel actions.',
    ],
  },
  {
    version: '1.0.9',
    releasedAt: '2026-07-08',
    title: 'Incoming payment sender reuse',
    changes: [
      'Changed Incoming Payment report sending to reuse the saved app email sender chain.',
      'Uses Internal Email Reminder Sender first and Payment Reminder Sender as fallback before server-side SMTP.',
      'Shows which saved sender was used after a successful Incoming Payment report send.',
    ],
  },
  {
    version: '1.0.8',
    releasedAt: '2026-07-08',
    title: 'Incoming payment email error visibility',
    changes: [
      'Made Incoming Payment report send failures show a visible toast and modal error.',
      'Separated Previewing and Sending button states in the Incoming Payment report email modal.',
      'Hardened API calls so network failures return visible errors instead of leaving pages stuck.',
    ],
  },
  {
    version: '1.0.7',
    releasedAt: '2026-07-08',
    title: 'Incoming payment email report',
    changes: [
      'Simplified Incoming Payment KPIs by moving Buyer Payments and Supplier Refunds into the Incoming Total card.',
      'Removed the Incoming Payment CSV export action.',
      'Added an Incoming Payment report email workflow with editable recipients, template, preview, and inline Receivable Payments and Buyer CIA Invoices tables.',
      'Preserved Incoming Payment filters and loaded data when switching pages through a reusable page-state cache.',
    ],
  },
  {
    version: '1.0.6',
    releasedAt: '2026-07-08',
    title: 'Broker commission payment split',
    changes: [
      'Excluded broker commission payments from Receivable Payments.',
      'Added buyer, secondary buyer, and supplier broker commission paid-date tables in Stem Detail.',
      'Changed Supplier Invoice Paid Dates to show Supplier instead of Supplier Invoice.',
      'Renamed Buyer Pay Term Date to Buyer Invoice Due Date in Stem Detail.',
    ],
  },
  {
    version: '1.0.5',
    releasedAt: '2026-07-08',
    title: 'Dock-style collapsed sidebar',
    changes: [
      'Changed the collapsed sidebar into a dock-style navigation with hover magnification.',
      'Added visible hover labels beside collapsed navigation icons.',
      'Kept the expanded sidebar navigation behavior unchanged.',
    ],
  },
  {
    version: '1.0.4',
    releasedAt: '2026-07-08',
    title: 'Stem payment and bank charge refinement',
    changes: [
      'Grouped bank charge payments underneath their related Receivable Payments amount line.',
      'Moved supplier paid dates and buyer received dates into the Stem Detail financial panel.',
      'Removed the meaningless payment-name column from Stem Detail payment date tables.',
      'Added receivable and payable balances to Stem Detail financials and removed less useful total fields.',
    ],
  },
  {
    version: '1.0.3',
    releasedAt: '2026-07-08',
    title: 'Incoming payment source correction',
    changes: [
      'Filtered Buyer CIA Invoices to exclude STEMs with delivery dates before 1 Jan 2026.',
      'Corrected Receivable Payments so positive supplier-side payments are not shown as buyer receipts.',
      'Separated Stem Detail supplier paid dates from buyer received dates using supplier-side payment classification.',
    ],
  },
  {
    version: '1.0.2',
    releasedAt: '2026-07-08',
    title: 'Receivable payment cleanup and CIA monitor',
    changes: [
      'Excluded outgoing supplier payments from Incoming Payment unless the supplier payment amount is negative as a supplier refund.',
      'Renamed Salesforce Payment Records to Receivable Payments and simplified columns around status, received date, payment terms, delay, sender, group, STEM, amount, and receivable balance.',
      'Added Buyer CIA Invoices to monitor unpaid CIA buyer invoice STEMs with buyer, group, buyer trader, STEM, calculated amount, receivable balance, and delivery date.',
      'Added an administrator-only reusable drag-and-drop column ordering component and applied it to the Incoming Payment tables.',
    ],
  },
  {
    version: '1.0.1',
    releasedAt: '2026-07-08',
    title: 'Incoming Payment table workflow',
    changes: [
      'Made Incoming Payment rows open Stem Detail when a linked STEM exists.',
      'Removed the Payment Details column and reordered payment records around type, dates, delay, sender, group, and STEM.',
      'Added buyer invoice due date and payment delay for buyer payments.',
      'Changed the default Incoming Payment filters to today-to-today and all payment types.',
    ],
  },
  {
    version: '1.0.0.22',
    releasedAt: '2026-07-08',
    title: 'Incoming Payment display refinement',
    changes: [
      'Changed Incoming Payment records to show meaningful payment details from reference, description, remittance, bank, and transaction fields.',
      'Kept the raw Salesforce payment name as secondary text only when it differs from the payment details.',
      'Updated Incoming Payment CSV export to include both payment details and Salesforce payment name.',
    ],
  },
  {
    version: '1.0.0.21',
    releasedAt: '2026-07-08',
    title: 'Incoming Payment workspace',
    changes: [
      'Added an Incoming Payment page for buyer payments received and supplier refunds from Salesforce Payment__c records.',
      'Added buyer-group available balance tracking based on overpaid STEM receivable balances.',
      'Added a global fully paid threshold setting with administrator-only editing.',
      'Added conservative administrator-only allocation preparation that blocks Salesforce write-back until target allocation fields are confirmed.',
    ],
  },
  {
    version: '1.0.0.20',
    releasedAt: '2026-07-08',
    title: 'Dispute Workflow queue readability',
    changes: [
      'Combined buyer and buyer invoice due date into one two-line queue column.',
      'Moved product and quantity details into a separate Products column between buyer and supplier details.',
      'Grouped supplier invoice due details so supplier names are not repeated for every product line.',
      'Moved delivery date under the STEM name to reduce queue table width.',
    ],
  },
  {
    version: '1.0.0.19',
    releasedAt: '2026-07-08',
    title: 'Dispute Workflow queue and P&L labels',
    changes: [
      'Renamed Dispute Workflow settlement labels to Dispute P&L and added STEM P&L including dispute impact to the manage modal header.',
      'Removed duplicate receivable display from the Dispute Workflow manage modal header.',
      'Added delivery date, buyer invoice due date, and supplier invoice due/product quantity details to the Dispute Workflow queue.',
      'Capitalized Dispute Workflow close reason labels while preserving compatibility with previously saved lowercase values.',
    ],
  },
  {
    version: '1.0.0.18',
    releasedAt: '2026-07-08',
    title: 'Dispute Workflow settlement refinement',
    changes: [
      'Dispute Workflow now treats buyer and supplier settlement credit notes as lump-sum amounts instead of unit-price spreads.',
      'The manage modal now shows buyer receivable and every supplier invoice/payable row even when that party is not under dispute.',
      'Dispute Workflow queue rows now open the standard Stem Detail modal, while Manage opens the workflow modal.',
    ],
  },
  {
    version: '1.0.0.17',
    releasedAt: '2026-07-07',
    title: 'Dispute Workflow',
    changes: [
      'Added a separate Dispute Workflow page while keeping the existing Dispute Management page unchanged.',
      'Added Supabase-backed trader actions, dispute administrator approval, execution tracking, audit events, and settlement P&L.',
      'Approved workflow actions write back only summary status, description, and deduction amount to existing Salesforce dispute records.',
    ],
  },
  {
    version: '1.0.0.16',
    releasedAt: '2026-07-07',
    title: 'Payment reminder prepare fix',
    changes: [
      'Fixed the payment reminder prepare error caused by an obsolete recipient-template variable.',
      'Payment reminder previews continue to use editable per-batch To, CC, and BCC fields.',
    ],
  },
  {
    version: '1.0.0.15',
    releasedAt: '2026-07-07',
    title: 'Explicit reminder batch recipients',
    changes: [
      'Outstanding payment reminder preview now shows editable To, CC, and BCC fields for every selected email batch.',
      'Payment reminder sending now uses only the final reviewed recipient fields shown in the preview.',
      'The server now rejects payment reminder sends without reviewed recipient batches to prevent hidden automatic routing.',
    ],
  },
  {
    version: '1.0.0.14',
    releasedAt: '2026-07-07',
    title: 'Broker routing warning in preview',
    changes: [
      'Payment reminder email preview now shows broker routing warnings before sending.',
      'Blank or unknown broker invoice/email formats now explicitly warn that broker email is not automatically added to BCC.',
    ],
  },
  {
    version: '1.0.0.13',
    releasedAt: '2026-07-07',
    title: 'Buyer-only broker email retention',
    changes: [
      'Explicit Buyer Only broker reminder routing now keeps broker email addresses so they can be added to automatic BCC.',
      'Blank or unknown broker invoice formats continue to avoid silent broker BCC routing.',
    ],
  },
  {
    version: '1.0.0.12',
    releasedAt: '2026-07-07',
    title: 'Buyer-only reminder broker BCC',
    changes: [
      'Broker-only outstanding payment reminders no longer automatically BCC the broker email address.',
      'Buyer-only outstanding payment reminders now automatically BCC broker email addresses when buyer broker routing data is present.',
    ],
  },
  {
    version: '1.0.0.11',
    releasedAt: '2026-07-07',
    title: 'Broker-only reminder BCC',
    changes: [
      'Broker-only outstanding payment reminders now automatically add broker email addresses to BCC for the matching email batch.',
      'Payment reminder preview now shows automatic Broker BCC recipients in the batch summary.',
    ],
  },
  {
    version: '1.0.0.10',
    releasedAt: '2026-07-07',
    title: 'Reports Archive access levels',
    changes: [
      'Added Read Only and Full Access levels for Reports Archive in Admin Control.',
      'Read-only archive users can view audit history, open Drive files, and download XLS reports.',
      'Rename and delete actions now require Full Access and are enforced by the server.',
    ],
  },
  {
    version: '1.0.0.9',
    releasedAt: '2026-07-07',
    title: 'Google Drive archive setup',
    changes: [
      'Completed Google Drive OAuth production setup for archived XLS exports.',
      'Fixed notification close buttons so XLS archive success and failure messages can be dismissed.',
    ],
  },
  {
    version: '1.0.0.8',
    releasedAt: '2026-07-06',
    title: 'Dashboard table auto-fit',
    changes: [
      'Filtered STEMs now auto-fits to the remaining browser height when analytics are hidden.',
      'The dashboard table scrolls internally so the browser window does not need vertical scrolling in hidden analytics mode.',
    ],
  },
  {
    version: '1.0.0.7',
    releasedAt: '2026-07-06',
    title: 'Dashboard analytics toggle',
    changes: [
      'Added a dashboard Show analytics / Hide analytics toggle.',
      'Dashboard KPIs and chart areas are hidden by default while the filtered STEM table remains visible.',
      'Analytics visibility is saved locally without refreshing Salesforce data.',
    ],
  },
  {
    version: '1.0.0.6',
    releasedAt: '2026-07-06',
    title: 'Dashboard KPI wording fix',
    changes: [
      'Fixed Turnover KPI display by falling back to the existing buyer invoice total when needed.',
      'Updated dashboard KPI notes for Turnover, Gross Profit Total, Gross Margin, and Product Volume.',
    ],
  },
  {
    version: '1.0.0.5',
    releasedAt: '2026-07-06',
    title: 'Broker routing and commission exclusions',
    changes: [
      'Outstanding buyer invoice reminders no longer route to hidden broker individual or hidden broker company accounts.',
      'Added broker commission row inclusion checkboxes so selected rows can be excluded from totals.',
      'Broker summary, page summary, CNY summary, and XLS export now use only included broker commission rows.',
    ],
  },
  {
    version: '1.0.0.4',
    releasedAt: '2026-07-06',
    title: 'Dashboard KPI and payment details',
    changes: [
      'Added Turnover KPI to the dashboard using filtered buyer invoice total.',
      'Standardized the Product Volume KPI layout with the other dashboard KPI cards.',
      'Added a wide-view toggle for the dashboard Filtered STEMs table.',
      'Added supplier invoice paid dates and buyer invoice received dates to Stem Detail.',
    ],
  },
  {
    version: '1.0.0.3',
    releasedAt: '2026-07-06',
    title: 'Buyer broker reminder routing',
    changes: [
      'Added buyer broker routing metadata to Outstanding Buyer Invoices.',
      'Payment reminders now route buyer-only, broker-only, or buyer-with-broker-copied based on Salesforce broker Invoice Format.',
      'Broker reminders use the broker Account email field, not broker invoice email or accounts email.',
      'Added routing details and warnings to the payment reminder selection workflow.',
    ],
  },
  {
    version: '1.0.0.2',
    releasedAt: '2026-07-06',
    title: 'Live update notification',
    changes: [
      'Added top-of-app notification when a newer Vercel deployment is available.',
      'Added Update Now action to clear browser caches and refresh the app to the latest deployment.',
      'Added build metadata generation so open browser sessions can detect new deployments.',
    ],
  },
  {
    version: '1.0.0.1',
    releasedAt: '2026-07-06',
    title: 'Operational analytics baseline',
    changes: [
      'Added version audit trail access from the main app sidebar.',
      'Added dashboard monthly volume view with HSFO, VLSFO, and LSMGO stacked by month.',
      'Updated dashboard port filtering so the same search box matches both port country and port name.',
      'Added grouped copy selection for outstanding buyer invoices by buyer and buyer group.',
      'Included recent broker commission, dispute management, document management, payment reminder, and collection workflow improvements in this baseline release.',
    ],
  },
];
