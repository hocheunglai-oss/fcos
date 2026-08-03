export const APP_PORTAL_METHODOLOGY = {
  title: 'Application Portal',
  description: 'How FCOS determines application access, availability, launch behavior, and sign-out.',
  sections: [
    {
      title: 'Application access',
      body: 'The portal shows only applications available to the signed-in user. FCOS permissions and external-application entitlements are evaluated independently, so access to one application never implies access to another.',
    },
    {
      title: 'Launch and identity',
      body: 'FCOS opens in the current tab. External applications open in a new tab through a short-lived, single-use server handoff; FCOS passwords and browser access tokens are not sent to the target application.',
    },
    {
      title: 'Availability and synchronization',
      body: 'An external application is launchable only when its entitlement is synchronized and its health check is available. A target outage or pending access update does not prevent normal FCOS use.',
    },
    {
      title: 'Sign out',
      body: 'Sign out asks registered target applications to revoke their active sessions before ending the FCOS session. An incomplete target logout is recorded for retry without keeping the FCOS session open.',
    },
  ],
};

export const MY_COMMITMENTS_METHODOLOGY = {
  title: 'My Commitments',
  description: 'How FCOS combines personal work and determines urgency.',
  sections: [
    {
      title: 'Included work',
      body: 'The page combines actionable Projects & Tasks items and Growth & Coaching commitments for which you are an owner, assignee, employee, manager, coaching participant, or action owner. It is a personal work view, not a privacy boundary.',
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
      body: 'Selecting an item opens its source record. Refresh retrieves current workflow state; My Commitments does not copy or independently edit the underlying record.',
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
        body: 'A buyer receipt made on or before either the earliest available Salesforce ETA date or the actual delivery date is CIA. Open balances display Partial CIA; a live Salesforce balance within the fully-paid threshold displays Full CIA. Later receipts display Partial Payment or Full Payment. Each row shows the comparison dates, and multiple receipts are split into CIA and other-payment totals.',
      },
      {
        title: 'Reminder safety',
        body: 'Before sending, FCOS bypasses caches and revalidates the live Salesforce balance, payment evidence, reminder policy, routing, and recipient eligibility. An unresolved payment-posting difference pauses every external reminder route. Finance may allow contact for that exact exception only by recording a reason; a changed payment set or resolved exception automatically clears the override.',
      },
      {
        title: 'Settlement',
        body: 'Salesforce Receivable Balance is authoritative. A balance within the configured fully-paid threshold automatically closes an existing case; partial payments preserve the active collection stage and remaining balance.',
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
        body: 'FCOS automatically closes an existing case when the verified balance satisfies the fully-paid threshold and records the previous active status. A system-closed case reopens if the balance later rises; a manually closed mismatch remains an exception for review.',
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
        body: 'Buyer-side and supplier-side commission values remain attributable to their exact broker and STEM. Missing or incomplete source values stay visible for review rather than being silently estimated.',
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
  ],
};

export const MARKETS_METHODOLOGY = {
  title: 'Markets',
  description: 'How FCOS maintains MOPS market records and forward adjustments.',
  sections: [
    {
      title: 'Market records',
      body: 'Actual and estimated Singapore MOPS observations are kept separately. Daily publication rows provide the calculation inputs and do not require individual source verification.',
    },
    {
      title: 'Automatic hedge expiry',
      body: 'FCOS expires a paper hedge automatically only after every contract month reaches its final Platts trading day, every scheduled MOPS row contains complete actual values, and a user saves the manual verification text for the final monthly average. FCOS stores but does not parse or compare that text. Spread hedges wait for both contract months. A daily-value change makes the monthly verification stale.',
    },
    {
      title: 'Forward adjustments',
      body: 'Forward adjustments supplement current market indications for open exposure views. They do not replace final published MOPS and are saved with revision protection.',
    },
    {
      title: 'Access',
      body: 'Every active FCOS user can view Markets. Only users with Manage Hedge Book permission may create, edit, or remove price records and change forward adjustments.',
    },
  ],
};

export const SETTINGS_METHODOLOGIES = {
  system: {
    title: 'System Settings',
    description: 'How operational configuration, integrations, AI, and health information are managed.',
    sections: [
      {
        title: 'Configuration authority',
        body: 'Saved settings apply only to their named FCOS workflow. Server-owned defaults are merged with stored values, and sensitive credentials remain protected Vercel environment variables rather than browser-editable settings.',
      },
      {
        title: 'Email and external actions',
        body: 'Every email purpose uses its assigned Microsoft 365 mailbox through Microsoft Graph and Vercel OIDC. Administrators and the General Manager maintain approved mailboxes and purpose assignments in Email Senders, while the Email Router tab manages its native directory, groups, routing presets, subscriptions, and mailbox synchronization. Templates, recipients, schedules, mailbox assignments, and delivery remain subject to the external-action safety gate. Saving a setting does not send an email.',
      },
      {
        title: 'AI configuration',
        body: 'Administrators select server-allowlisted models for Dashboard AI Search, the Hedge Desk Trading Assistant, and Email Router Advisor in one AI Models tab and can review estimated API cost by purpose. Email Router recommendations are read-only, use minimum live message text, store no email content, and never receive mail-action tools.',
      },
      {
        title: 'System health',
        body: 'Health states combine direct probes and provider telemetry. FCOS checks the single Microsoft Graph application, approved mailbox registry, and purpose assignments through a non-sending Vercel OIDC token exchange. Mailbox-scoped send authorization is confirmed only by an actual send. Monitoring unavailable is distinct from Online; a missing metric is never presented as a healthy result.',
      },
    ],
  },
  users: {
    title: 'Users & Access',
    description: 'How FCOS user access, application entitlements, reporting lines, and controlled administration work.',
    sections: [
      {
        title: 'User status and modules',
        body: 'Only active FCOS profiles may use authenticated APIs. Module permissions, including Email Router visibility, are managed by user type or individual override and are applied before personal navigation preferences. Hiding a navigation item does not grant or remove module access.',
      },
      {
        title: 'Application entitlements',
        body: 'External application access is versioned and synchronized to the target. Automatic Administrator policies and explicit grants remain distinguishable so downgrades and revocations behave predictably.',
      },
      {
        title: 'Reporting lines and authority',
        body: 'Growth & Coaching reporting assignments are maintained explicitly and reject self-management, duplicates, inactive managers, and primary-manager cycles. General Manager is a protected user type selected in Users & Access. The one active UUID-backed holder is the hierarchy root, requires neither a Primary nor Advisory Manager, and self-manages formal goals while remaining available to manage other employees.',
      },
      {
        title: 'Administrative safeguards',
        body: 'Revision checks prevent stale saves and important changes require audit context. General Manager authority transfers atomically to one active user; the former holder becomes an Administrator and then requires a reporting line. FCOS blocks direct demotion, deactivation, or deletion of the active General Manager.',
      },
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
