export const ACCOUNT_MANAGERS_METHODOLOGY = {
  title: 'Account Managers',
  description: 'How Account coverage, manager priority, GROUP propagation, notes, and synchronization work.',
  sections: [
    {
      title: 'Account coverage',
      body: 'The directory groups active Buyer, Buyer & Supplier, Broker, and GROUP Salesforce Accounts by normalized Account name. GROUP Accounts appear first. Supplier-only and inactive Accounts are excluded, while every result keeps its Account name and CL Key visible.',
    },
    {
      title: 'Manager priority',
      body: 'Each Account name may have zero to three active FCOS managers. Priority 1 is highest; drag the rows to change order. Same-name Salesforce Account records share one ordered FCOS assignment and are synchronized together.',
    },
    {
      title: 'GROUP scope',
      body: 'GROUP only saves the GROUP assignment, disables continuous inheritance, and leaves existing child assignments and Salesforce values unchanged. GROUP + children replaces direct-child assignments and Salesforce values and enables inheritance for current eligible children. GROUP note propagation is a one-time copy; child notes remain independently editable.',
    },
    {
      title: 'Synchronization and search',
      body: 'FCOS stores ordered user IDs and writes display names to Salesforce Account Manager. GROUP-family writes are all-or-none; drift and failures stay visible for retry. Search covers Account name, CL Key, GROUP relationships, Account type, manager identity, and the 255-character FCOS note.',
    },
  ],
};

export const CASHFLOW_FORECAST_METHODOLOGY = {
  title: 'Cashflow Forecast',
  description: 'How Salesforce receivables and payables become expected daily cash movement.',
  sections: [
    {
      title: 'Purpose and scope',
      body: 'The page forecasts AR receipts and AP payments for planning; it does not post accounting entries. STEMs delivered before 1 January 2026 are excluded, and currencies remain separate because this page performs no currency conversion.',
    },
    {
      title: 'Buyer receipts',
      body: 'Buyer rows use open buyer-invoice inclusion rules and the current receivable balance. FCOS starts from the buyer due date, adds the expected payment delay, and uses today when that prediction is already past before applying business-day adjustments.',
    },
    {
      title: 'Payment delay model',
      body: 'Paid history before 1 January 2026 is ignored. The model uses the exact buyer when enough samples exist, then falls back to buyer GROUP and global history. Recent payments carry more weight; model level, sample count, and confidence remain visible for review.',
    },
    {
      title: 'Supplier payments',
      body: 'Open supplier invoices are expected as full cash outflows on their contractual due date. Supplier timing is not predicted from payment history, and a blocked date moves the payment forward rather than changing its amount.',
    },
    {
      title: 'Business days and controls',
      body: 'Dates use Hong Kong time. Weekends, Singapore public holidays, US bank or public holidays, and authorized manual blocked dates move a forecast to the next available day. Only users with Cashflow settings authority may change model parameters or manual dates.',
    },
  ],
};

export const GROWTH_COACHING_METHODOLOGY = {
  title: 'Growth & Coaching',
  description: 'How FCOS separates accountable development from private, equal-participant coaching.',
  sections: [
    {
      title: 'Formal development goals',
      body: 'Employees author measurable goals with a deadline and checkpoint. The Primary Manager approves each goal independently. The active General Manager is the UUID-backed reporting root and activates self-managed goals; an Advisory Manager has read-only visibility and cannot comment, approve, or complete goals. Material changes to an approved goal create a new approval revision.',
    },
    {
      title: 'Progress and completion',
      body: 'Employees record progress and evidence while managers comment and decide formal outcomes. Missed checkpoints and deadlines remain overdue. The General Manager self-completes with final evidence or records not achieved with a note. Completed Projects & Tasks items may be linked as private evidence.',
    },
    {
      title: 'Equal-participant coaching',
      body: 'Any two active users may form a coaching relationship after mutual acceptance. Private preparation remains visible only to its author; shared notes, actions, files, and decisions remain visible only to the pair. Both participants confirm closure, later corrections are append-only, and proposed actions require acceptance by the assigned participant.',
    },
    {
      title: 'Calendar, notifications, and boundaries',
      body: 'FCOS owns the coaching schedule and requests neutral Outlook events without silently overwriting conflicts. In-app notifications remain active and email categories are configurable. Coaching has no Administrator or General Manager content override and creates no ratings, compensation decisions, or Salesforce changes.',
    },
  ],
};

export const PROJECTS_TASKS_METHODOLOGY = {
  title: 'Projects & Tasks',
  description: 'How shared work, authority, progress, notifications, dependencies, and private files operate.',
  sections: [
    {
      title: 'Visibility and ownership',
      body: 'Every active FCOS user can see active projects, tasks, subtasks, comments, files, progress, and activity. The creator is the immutable owner. Only that owner or the active General Manager may assign, move, archive, restore, or manage dependencies.',
    },
    {
      title: 'Hierarchy and progress',
      body: 'Projects contain tasks; tasks may contain one level of subtasks, while standalone tasks are allowed. A leaf item derives progress from status. Parent progress is calculated from non-cancelled active children, and a parent cannot become Done while any non-cancelled child is incomplete.',
    },
    {
      title: 'Collaboration controls',
      body: 'Owners, assignees, and the General Manager may update work details. Every active user may comment, mention colleagues, follow work, and upload files. Blocked work requires a reason, circular dependencies are rejected, and revision checks return current server state instead of overwriting concurrent edits.',
    },
    {
      title: 'Repeat work and notifications',
      body: 'Project health, milestones, templates, and controlled bulk changes support recurring work while preserving each item revision. FCOS notifies assignments, mentions, relevant changes, due-today work, and overdue work once per event, excluding the actor.',
    },
    {
      title: 'Files',
      body: 'Files use private storage and short-lived access links. Approved business formats are limited to 20 MB, duplicate display names receive an incremental suffix, and archived work remains historical rather than being physically deleted.',
    },
  ],
};

export const EMAIL_ROUTER_METHODOLOGY = {
  title: 'Email Router',
  description: 'How FCOS retrieves messages and submits controlled Microsoft Graph mailbox actions.',
  sections: [
    { title: 'Mailbox data', body: 'Inbox, Sent, and Archive are read from the assigned Microsoft 365 mailbox. Message bodies and attachment bytes remain in Microsoft 365 and are fetched temporarily only when opened.' },
    { title: 'Routing directory and presets', body: 'Administrators and the General Manager maintain ordered active-user labels, approved external contacts, groups, and case-sensitive labels. A preset family has a Standard route plus optional leave-aware versions; scheduled overrides win before priority and specificity. Manual recipient amendments clear the selected preset.' },
    { title: 'Routing leave and snapshots', body: 'My Routing Leave records operational availability, not HR approval. A reviewed preset route is held by a server-signed snapshot for up to 60 minutes unless directory or preset configuration changes. FCOS warns, but does not block, when a chosen recipient is currently on leave.' },
    { title: 'Recipients and actions', body: 'Redirect numbers To, Cc, and Bcc independently and preserves visible To/Cc order; Bcc stays private and hidden until used. Redirect has one explicit Send command. Reply, Forward, Archive, Delete, Undo, and uncertain-send review keep their applicable safeguards.' },
    { title: 'Submission safety', body: 'Graph submission is durable: Reserved, Draft Created, Submitted, Confirmed, Failed, or Uncertain. A 202 response is not treated as delivery, sent-mail reconciliation confirms submission, source mail is archived only after confirmation, and FCOS never automatically retries after submission begins.' },
    { title: 'Advisor and display safety', body: 'The Advisor is read-only and preselects recipients only above 60% confidence; a user must still review and send. HTML is sanitized, embedded images are streamed through authorized temporary endpoints, and unavailable inline images receive a visible placeholder.' },
  ],
};

export const MY_COMMITMENTS_METHODOLOGY = {
  title: 'My Commitments',
  description: 'How FCOS combines personal work and determines urgency.',
  sections: [
    {
      title: 'Included work',
      body: 'The page combines Projects & Tasks, Growth & Coaching, assigned Payment Collections, dispute approvals and accounting work, Hedge settlement decisions, Email Router warnings, and operational system errors. FCOS evaluates each source using your current server-side permissions; this is a personal action view, not a privacy boundary.',
    },
    {
      title: 'Urgency order',
      body: 'FCOS evaluates dates in Hong Kong time and groups work as Needs action, Overdue, Due today, Coming seven days, Waiting for others, Later, or No due date. Overdue and decision-blocking work appears before future commitments.',
    },
    {
      title: 'Waiting for others',
      body: 'Items are placed in Waiting for others when another participant must approve, confirm, accept, or complete the next step. The source workflow remains authoritative for permissions and status changes.',
    },
    {
      title: 'Opening and refresh',
      body: 'Each row states the next action and opens the exact source record where possible. Refresh retrieves current workflow and notification state; My Commitments does not copy, settle, approve, or independently edit the underlying record.',
    },
  ],
};

export const DASHBOARD_METHODOLOGY = {
  title: 'Dashboard',
  description: 'How record scope, financial KPIs, volume, filters, and AI Search are calculated.',
  sections: [
    {
      title: 'Record period',
      body: 'The selected year and month use actual Delivery Date when present and Expected Delivery Date otherwise. Country, buyer or supplier, dispute, and table filters narrow the same underlying Salesforce result set.',
    },
    {
      title: 'Financial calculations',
      body: 'After delivery, buyer turnover uses the Salesforce buyer invoiced total. Before delivery, FCOS uses calculated line-item and extra-cost selling values when available. Supplier cost combines current supplier invoicing with eligible uninvoiced line-item and extra-cost costs. Gross profit deducts buyer and supplier broker commissions, and gross margin is gross profit divided by turnover when turnover is usable.',
    },
    {
      title: 'Volume statistics',
      body: 'Product volume is normalized to metric tonnes for statistics only. Litres are divided by 1,000 to KL; HSFO and VLSFO use 0.98 MT per KL, while LSMGO and other products use 0.85 MT per KL. These approximate density conversions never convert prices.',
    },
    {
      title: 'AI Search',
      body: 'An active AI Search replaces normal non-date filters and recalculates the Dashboard from a server-validated search interpretation. The selected period remains effective unless the request explicitly specifies another date range. Cancelled child records are excluded unless requested.',
    },
    {
      title: 'Caching and refresh',
      body: 'Normal loads may reuse a short Salesforce cache. Refresh bypasses browser and server caches. Detailed STEM data remains available on demand and consequential workflows revalidate live Salesforce data separately.',
    },
  ],
};

export const QLIK_VALIDATOR_METHODOLOGY = {
  title: 'Dashboard and Qlik Validator Tool',
  description: 'How FCOS selects STEMs and compares calculated profit with Qlik values.',
  sections: [
    {
      title: 'Period and record scope',
      body: 'The report uses the selected year and optional month. Delivery Date is used when present; Expected Delivery Date is the fallback for STEMs without an actual delivery date.',
    },
    {
      title: 'FCOS gross profit',
      body: 'FCOS compares buyer invoicing, supplier invoicing, supplier broker commission, and buyer broker commission to derive the report gross profit. Missing financial inputs remain visible rather than being treated as zero.',
    },
    {
      title: 'Qlik comparison',
      body: 'Difference is FCOS Gross Profit less Qlik Net. A difference identifies a reconciliation item; it does not automatically establish which source is correct.',
    },
    {
      title: 'Search, detail, and export',
      body: 'Search narrows the loaded report without changing totals returned for the selected period. STEM detail supports investigation, and CSV export preserves the loaded row-level comparison.',
    },
  ],
};

export const EXCEPTION_REVIEW_METHODOLOGY = {
  title: 'Exception Review',
  description: 'How FCOS identifies finance exceptions and coordinates their resolution.',
  sections: [
    {
      title: 'Date scope',
      body: 'Actual Delivery Date takes precedence. Without it, an ETA or ETB schedule is included when its date range overlaps the selected period. PROMPT or an unusable schedule falls back to the STEM creation date converted to Hong Kong time.',
    },
    {
      title: 'Exception reasons',
      body: 'The queue identifies missing buyer invoicing, missing supplier invoicing, negative gross profit, and Potential Delay. Potential Delay begins three days after the effective schedule end and requires at least one uncancelled STEM line product item.',
    },
    {
      title: 'Workflow ownership',
      body: 'Status, department, owner, priority, due date, notes, and resolution are FCOS collaboration state. Salesforce remains the financial record source; resolving or dismissing an FCOS review does not modify Salesforce invoices.',
    },
    {
      title: 'Search and finance handoff',
      body: 'Search includes STEM, buyer, vessel, port, port country, schedule type, and schedule dates. Finance handoffs are separately signed operational records and remain visible alongside the exception workflow.',
    },
    {
      title: 'Refresh and export',
      body: 'Refresh retrieves current Salesforce and workflow state. CSV export uses the displayed Delivery / Schedule rule and the current filtered exception set.',
    },
  ],
};

export const DISPUTE_WORKFLOW_METHODOLOGY = {
  title: 'Dispute Workflow',
  description: 'How FCOS identifies parties, coordinates decisions, settles instructions, and closes a dispute.',
  sections: [
    {
      title: 'Case and party identity',
      body: 'FCOS keeps one workflow case per disputed STEM. Disputed parties are the STEM buyer and eligible supplier Accounts found on line items or extra costs, including cancelled records. Suppliers are deduplicated by Salesforce Account ID, never by display name or payment term.',
    },
    {
      title: 'Commercial decision',
      body: 'Traders prepare one outcome for each selected party. Approval confirms the commercial amount and instruction; later accounting movements do not change the approved dispute P&L unless the commercial outcome itself is revised.',
    },
    {
      title: 'Supplier payment state',
      body: 'For supplier recovery, FCOS allocates the agreed amount across source invoices and separates the amount not to pay from the amount already paid that Finance must get back. Live balances and valid payment evidence are revalidated before consequential updates.',
    },
    {
      title: 'Documents and accounting',
      body: 'Documents remain Salesforce Files linked to the exact STEM and party records. Accounting tracks instructions as Pending Accounting, Instruction Issued, Settled, or Not Required and requires evidence or a reference where the outcome has a financial effect.',
    },
    {
      title: 'Closure',
      body: 'Every added action and generated supplier instruction must be Settled or Not Required before FCOS closure. Current Salesforce dispute status and balances are checked again; external Salesforce closure is displayed without silently overwriting the FCOS audit history.',
    },
    {
      title: 'Role rules',
      body: 'Workflow Rules provides the detailed Trader, Approver, Finance, Accounting, and closure responsibilities. Methodology explains calculation and identity; Workflow Rules explains who may perform each step.',
    },
  ],
};

export const UNOFFICIAL_COMPENSATION_METHODOLOGY = {
  title: 'Unofficial Compensation',
  description: 'How FCOS combines Salesforce claims and recoveries and controls compensation changes.',
  sections: [
    {
      title: 'Balance identity',
      body: 'Salesforce remains authoritative. FCOS groups each balance by exact Account ID, Contact ID, and currency. Agreed Compensation is the positive claim; negative UOC records are displayed as positive Recovered amounts. Different currencies are never netted together.',
    },
    {
      title: 'Outstanding and deadlines',
      body: 'Outstanding equals Agreed Compensation plus the signed UOC amount. Balances above 0.005 are outstanding. The queue prioritizes overdue deadlines, then the earliest deadline and largest outstanding balance.',
    },
    {
      title: 'Controlled changes',
      body: 'Manage opens the selected Account\'s existing open and closed claims, agreed amounts, and recoveries. Open New Claim is a separate creation flow requiring an active Account, positive amount, deadline, and Salesforce PIC. Recovery Account eligibility, Product, quantity, delivered quantity, UOM, currency, and amount are re-derived from live Salesforce records immediately before creation.',
    },
    {
      title: 'Status and deletion',
      body: 'Finance, Administrators, and the General Manager may open or close an Account and Contact claim group. Salesforce updates every claim plus the Account status all-or-none and requires a reason. Only an erroneous UOC recovery may be deleted in FCOS, with explicit confirmation and an audit reason.',
    },
    {
      title: 'Dispute linkage',
      body: 'A dispute closed as UOC opened must link an open Agreed Compensation claim for the exact dispute-party Account. Approval may continue without the link, but final closure is blocked until the claim is linked and revalidated.',
    },
  ],
};

export const PAYMENT_COLLECTIONS_METHODOLOGIES = {
  collections: {
    title: 'Payment Collections',
    description: 'How FCOS prioritizes buyer collection work and controls external reminders.',
    sections: [
      {
        title: 'Case identity and status',
        body: 'Collection work is managed once per Salesforce STEM. Status represents the current collection stage; reminders, calls, notes, promises, advice, payments, ownership changes, and reconciliation outcomes remain timeline events.',
      },
      {
        title: 'Dispute visibility',
        body: 'A STEM with a Salesforce Dispute Status other than No Dispute is marked in the STEM column. Active disputes use an amber indicator, closed disputes retain a neutral history indicator, and an unfamiliar status is flagged for review. The marker and dispute filter are informational and do not alter collection priority or reminder eligibility.',
      },
      {
        title: 'Needs Action priority',
        body: 'Reconciliation problems rank first, followed by overdue unverified advice, missed promises, overdue follow-ups, overdue invoices not yet contacted, and due-today or upcoming actions. Older overdue days and larger receivable balances break remaining ties.',
      },
      {
        title: 'Promises and payment advice',
        body: 'A promise requires a date and amount. Payment Advice Received requires an advice date, positive amount, verification date, and buyer reference or Salesforce document. Advice pauses reminders until verification but never proves settlement by itself.',
      },
      {
        title: 'CIA payment timing',
        body: 'A buyer receipt made on or before either the earliest available Salesforce ETA date or the actual delivery date is CIA. Open balances display Partial CIA; a live Salesforce balance satisfying its ISO-currency fully-paid rule displays Full CIA. Later receipts display Partial Payment or Full Payment. Each row shows the comparison dates, and multiple receipts are split into CIA and other-payment totals.',
      },
      {
        title: 'Reminder safety',
        body: 'Before sending, FCOS bypasses caches and revalidates the live Salesforce balance, payment evidence, reminder policy, routing, and recipient eligibility. An unresolved payment-posting difference pauses every external reminder route. Finance may allow contact for that exact exception only by recording a reason; a changed payment set or resolved exception automatically clears the override.',
      },
      {
        title: 'Settlement',
        body: 'Salesforce Receivable Balance is authoritative. Automatic closure uses the configured threshold for the STEM currency. An unconfigured currency closes only when the absolute live balance is below 0.005; overpayments also qualify. Partial payments preserve the active collection stage and remaining balance.',
      },
    ],
  },
  incoming: {
    title: 'Incoming Payments',
    description: 'How received-payment records are connected to collection work.',
    sections: [
      {
        title: 'Payment source',
        body: 'Incoming Payments displays Salesforce payment records and their linked STEM information. FCOS does not create, alter, or post Salesforce payments from this workspace.',
      },
      {
        title: 'Collection cross-link',
        body: 'When a payment belongs to a STEM with collection activity, the row shows the current collection status, handler, promise or advice, next follow-up, and related timeline state.',
      },
      {
        title: 'Posting interpretation',
        body: 'A payment record is supporting evidence. FCOS compares the previous balance less all newly detected buyer payments with the current authoritative STEM receivable balance. It distinguishes Posting pending, Partially posted, Posting mismatch, and Posting overdue after one Hong Kong business day.',
      },
      {
        title: 'Refresh',
        body: 'Refresh retrieves current incoming payments and live collection reconciliation. Duplicate payment events are prevented through stable Salesforce payment identity.',
      },
    ],
  },
  reconciliation: {
    title: 'Reconciliation Exceptions',
    description: 'How FCOS compares collection state with live Salesforce balances and payments.',
    sections: [
      {
        title: 'Authoritative balance',
        body: 'STEM Receivable Balance is the settlement authority. Payment records support matching and timing analysis; a missing balance never qualifies for automatic closure.',
      },
      {
        title: 'Automatic closure and reopening',
        body: 'FCOS automatically closes an existing case when the verified balance satisfies its ISO-currency threshold and records the previous active status. An unconfigured currency uses the strict absolute-balance rule below 0.005. A system-closed case reopens if the balance later rises; a manually closed mismatch remains an exception for review.',
      },
      {
        title: 'Exception types',
        body: 'Payment posting is Pending when no expected movement appears, Partially posted when only part appears, Mismatched when the movement differs in another way, and Overdue when an unchanged pending difference remains after one Hong Kong business day. The table shows prior balance, detected payments, expected balance, current balance, difference, and age. Other exceptions include overdue advice, manual closure with an open balance, and missing balances.',
      },
      {
        title: 'Reminder control',
        body: 'Every active posting discrepancy pauses external reminders, including broker-only routing. Finance, Administrators, and the General Manager may record a reason to allow reminders for the current issue. The exception clears only when the Salesforce balance movement matches the detected payment movement within the monetary tolerance.',
      },
      {
        title: 'Refresh behavior',
        body: 'The workspace reconciles on live refresh and through a scheduled background check. Refresh Salesforce bypasses caches and updates collection state idempotently without creating Salesforce financial records.',
      },
    ],
  },
};

export const BROKER_METHODOLOGIES = {
  commissions: {
    title: 'Broker Commissions',
    description: 'How FCOS scopes commission records, applies exchange rates, and produces reports.',
    sections: [
      {
        title: 'Record scope',
        body: 'The register is built from Salesforce broker commission and related STEM values within the selected delivery and payment filters. Search and status filters narrow the loaded register without changing source records.',
      },
      {
        title: 'Commission values',
        body: 'Buyer-side and supplier-side commission values remain attributable to their exact broker and STEM. Per-unit commission calculations use the Salesforce native quantity and native UOM. A missing UOM remains visible for review; FCOS does not infer a financial quantity from MT or approximate density conversions.',
      },
      {
        title: 'CNY conversion',
        body: 'When CNY reporting is selected, the Frankfurter USD/CNY rate is treated as the mid-rate and the bank buy rate is mid-rate multiplied by 0.998. The target-date rule and fallback rate date are included in each exported workbook.',
      },
      {
        title: 'Reports and payment state',
        body: 'Exports capture the selected register and methodology at generation time. Payment or approval actions follow their existing authorization and evidence rules and do not arise solely from a report calculation.',
      },
    ],
  },
  archive: {
    title: 'Report Archive',
    description: 'How generated reports are retained, filtered, and downloaded.',
    sections: [
      {
        title: 'Archive scope',
        body: 'The Broker Commissions workspace defaults the archive to broker-related exports. All Reports expands the view to other report types that the user is permitted to access.',
      },
      {
        title: 'Report snapshot',
        body: 'Each archive entry represents the generated file and parameters recorded at creation time. Later Salesforce changes do not rewrite an existing archived report.',
      },
      {
        title: 'Access and management',
        body: 'Viewing, downloading, and administrative management continue to use the existing report-archive permissions. Integrating the tab into Broker Commissions does not broaden access.',
      },
      {
        title: 'Download integrity',
        body: 'Downloads use the archived file reference and authenticated server access. If the stored file is unavailable, FCOS reports the failure rather than regenerating a potentially different report silently.',
      },
    ],
  },
  configuration: {
    title: 'Broker Commission Configuration',
    description: 'How the company exchange-rate provider is controlled and applied.',
    sections: [
      { title: 'Company setting', body: 'One server-owned provider setting applies to Broker Commissions, its exports, and related calculations for every user. Browser requests cannot override it.' },
      { title: 'Management authority', body: 'Finance, Administrators, and the active General Manager may change the provider. A Save button appears only after the selection changes, and revision checks reject stale updates.' },
      { title: 'Rate treatment', body: 'FCOS uses the latest available Frankfurter USD/CNY rate on or before the applicable quarter-end date. The bank buy rate remains the mid-rate multiplied by 0.998.' },
      { title: 'Audit', body: 'Provider changes record the actor, prior provider, new provider, revision, and time without storing credentials or request payloads.' },
    ],
  },
};

export const SPECIAL_TERMS_METHODOLOGY = {
  title: 'Special Terms',
  description: 'How FCOS manages authoritative Salesforce wording and matching rules.',
  sections: [
    {
      title: 'Salesforce authority',
      body: 'Special Terms and their rules are read live from Salesforce. FCOS validates the required objects, field types, and lookup targets through Salesforce describe metadata and blocks the workspace when the schema is incompatible.',
    },
    {
      title: 'Term wording',
      body: 'Terms Text contains the contractual wording. Confirmation and Nomination controls determine whether the PDF is attached, while their rich-text remarks supply document-specific wording.',
    },
    {
      title: 'Rule matching',
      body: 'A rule applies to either Buyer or Supplier and may use Account, Port, Product, and Country dimensions. Salesforce remains responsible for evaluating those combinations. Account searches always show Account name and CL Key; inactive Accounts and Products are not offered for new rules.',
    },
    {
      title: 'Priority',
      body: 'Salesforce calculates rule priority from specificity when a rule is inserted. FCOS displays but never writes that value; editing a rule replaces it atomically so the existing Salesforce trigger recalculates priority.',
    },
    {
      title: 'Controlled changes',
      body: 'Users need Manage Special Terms capability to write. FCOS revalidates Salesforce immediately, rejects stale edits, routes mutations through the Salesforce-write safety gate, and records idempotent operation history. Removing a term requires its exact name and an audit reason, then removes the term and all linked rules atomically.',
    },
    {
      title: 'Individual PDFs',
      body: 'Select one or more Terms to download a separate PDF for each. Every document is generated from the latest Salesforce Terms Text, repeats the approved company letterhead on every page, and excludes rules, remarks, attachment settings, identifiers, and administrative metadata.',
    },
    {
      title: 'Copying remarks',
      body: 'The Confirmation and Nomination copy controls place only the selected rich-text remark on the clipboard as readable plain text. Paragraphs and list items remain separated. Copying does not edit Salesforce or change an open form.',
    },
  ],
};

export const FCOS_IMPROVEMENTS_METHODOLOGY = {
  title: 'FCOS Improvements',
  description: 'How bugs and feature requests are reported, discussed, approved, and resolved.',
  sections: [
    {
      title: 'Shared visibility',
      body: 'Every active FCOS user can report a bug or propose a feature and can see every ticket, its approved history, pending proposals, comments, and private attachments. Bug reports require reproducible evidence; feature requests require a desired outcome and business value.',
    },
    {
      title: 'Controlled discussion and workflow',
      body: 'New tickets default to the active UUID-backed General Manager as accountable assignee. Comments, assignments, ticket edits, and status changes are proposals. They remain visibly Pending Approval until that General Manager approves or rejects them. Proposals created by the General Manager are applied immediately and recorded as approved. Reassignment remains available through the same controlled proposal workflow.',
    },
    {
      title: 'Status progression',
      body: 'Tickets progress through Reported, Under Review, Accepted, In Progress, Ready for Verification, and Closed. Reopened and Rejected preserve exceptional outcomes. The server validates every transition and rejects stale changes.',
    },
    {
      title: 'Codex collaboration',
      body: 'The ticket key is the stable reference for a later Codex task. Codex may inspect a ticket and propose a comment or status change through the local helper, but cannot approve its own proposal. The General Manager remains the decision authority.',
    },
    {
      title: 'Files and audit',
      body: 'Attachments are stored in a private Supabase bucket and opened through short-lived links. Operational events are added to the Universal Audit Trail using redacted metadata; ticket descriptions, comments, file names, and file contents are not copied into audit records.',
    },
  ],
};

export const SETTINGS_METHODOLOGIES = {
  my: {
    title: 'My Settings',
    description: 'How personal FCOS workspace preferences are synchronized and applied.',
    sections: [
      {
        title: 'Personal scope',
        body: 'Sidebar behavior, table density, navigation order, hidden navigation items, and STEM document filtering belong to your FCOS account. They do not change another user’s workspace or grant access to a module.',
      },
      {
        title: 'Cross-browser synchronization',
        body: 'FCOS stores the latest saved preferences against your active user account. Browser storage is retained only as an offline cache and is imported once when no server preference exists.',
      },
      {
        title: 'Navigation and refresh',
        body: 'Returning to a recently opened page reuses its user-specific browser snapshot. Operational data stays fresh for three minutes, collaboration data for 30 seconds, and reference data for 10 minutes. Moderately older data opens immediately and refreshes in the background; the Refresh button always bypasses browser and server caches. Saves and other successful changes invalidate affected browser snapshots, while approval, payment, email, document, and closure checks continue to validate live server data.',
      },
      {
        title: 'Save and conflicts',
        body: 'A Save button appears only after this section changes. Revision checks reject an older browser save if the same preferences were updated elsewhere, allowing the current server version to be reviewed before retrying.',
      },
    ],
  },
  people: {
    title: 'People & Access',
    description: 'How FCOS users, permissions, capabilities, and reporting lines are controlled.',
    sections: [
      {
        title: 'Access precedence',
        body: 'User-type defaults establish normal module and capability access. An individual override may narrow or extend it. Use the searchable compact tables to review users and templates; the full change history remains in the separate Audit Trail section.',
      },
      {
        title: 'Reporting lines',
        body: 'Primary Manager links define the formal management chain. Advisory Managers are read-only participants in development goals. The active UUID-backed General Manager is the hierarchy root and requires neither manager assignment.',
      },
      {
        title: 'Internal modules only',
        body: 'FCOS is the only application in this workspace. Obsolete external Application Access controls are not editable, while historical portal events remain available in the Audit Trail.',
      },
    ],
  },
  'email-delivery': {
    title: 'Email Delivery',
    description: 'How Microsoft Graph mailboxes are registered and assigned to FCOS email purposes.',
    sections: [
      {
        title: 'Graph-only delivery',
        body: 'Every FCOS email purpose uses one approved Microsoft 365 mailbox through Microsoft Graph and Vercel OIDC. Workflow requests cannot supply or replace the sender address.',
      },
      {
        title: 'Purpose assignments',
        body: 'Each enabled purpose has exactly one active mailbox. Administrators may amend several assignments, enter one audit reason, and save them in one transaction. If any selected route is stale or invalid, no assignment in the batch changes.',
      },
      {
        title: 'Configuration boundary',
        body: 'Mailbox addresses and purpose assignments are non-secret server settings. Tenant and application credentials remain protected in Vercel, while Exchange administrators control mailbox-scoped authorization.',
      },
    ],
  },
  ai: {
    title: 'AI Models',
    description: 'How FCOS selects models and reports usage without weakening workflow permissions.',
    sections: [
      {
        title: 'Purpose separation',
        body: 'Dashboard Search, Hedge Trading Assistant, and Email Router Advisor use the same selection, status, token, cost, and last-used format while retaining independent models, usage totals, and management permissions.',
      },
      {
        title: 'Data minimization',
        body: 'Dashboard interpretation sends only the natural-language request. Hedge and Email Router assistants receive only the minimum server-prepared context needed for their advisory response. Secrets and Salesforce identifiers are excluded.',
      },
      {
        title: 'Advisory boundary',
        body: 'AI output never grants access or performs a mail, accounting, settlement, or Salesforce action. Existing server validation and human confirmation remain authoritative.',
      },
    ],
  },
  updates: {
    title: 'FCOS Updates',
    description: 'How release changes are prepared and sent as controlled internal communications.',
    sections: [
      { title: 'Independent workflow', body: 'FCOS Updates has its own queue, batches, sent history, and skipped items. It is separate from user-access administration because release communication does not change permissions.' },
      { title: 'Draft and send authority', body: 'Administrators and the General Manager may draft and save. Only the active UUID-backed General Manager may send, and sending remains a deliberate action separate from saving.' },
      { title: 'Recipients and delivery', body: 'A send snapshots active FCOS users and reserves one Microsoft Graph delivery per recipient. Failed and uncertain attempts remain visible for controlled review without automatic duplication.' },
    ],
  },
  health: {
    title: 'System Health',
    description: 'How live service status and provider monitoring should be interpreted.',
    sections: [
      { title: 'Visible to every active user', body: 'All active FCOS users may inspect current service status, operational KPIs, provider links, and connection details. This visibility does not grant configuration or provider-dashboard write access.' },
      { title: 'Status meaning', body: 'Health states combine direct probes and provider telemetry. Monitoring unavailable is distinct from Online; missing or failed telemetry is never presented as healthy.' },
      { title: 'Non-sending checks', body: 'Email health verifies configuration and Microsoft token exchange without sending a message. Mailbox-scoped send authorization is conclusively confirmed only by an actual controlled delivery.' },
    ],
  },
  audit: {
    title: 'Audit Trail',
    description: 'How FCOS presents redacted operational and security history.',
    sections: [
      {
        title: 'Event scope',
        body: 'The trail combines supported administrative, collaboration, workflow, access, and external-action events. Source workflow records remain authoritative for full business context.',
      },
      {
        title: 'Redaction',
        body: 'Audit records retain actor, action, target type, timing, result, and safe metadata while excluding secrets, email bodies, recipient addresses, coaching content, private notes, and file contents.',
      },
      {
        title: 'Immutability and attribution',
        body: 'Events are append-only operational history. Later corrections create new events rather than changing prior attribution.',
      },
      {
        title: 'Search and retention',
        body: 'Filters narrow the available audit history for investigation. Absence from a filtered view does not mean the underlying business record or provider log was deleted.',
      },
    ],
  },
};
