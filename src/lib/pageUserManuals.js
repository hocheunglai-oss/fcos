export const DISPUTE_WORKFLOW_USER_MANUAL = Object.freeze({
  title: 'Dispute Workflow',
  description: 'A practical guide to recording, approving, settling, and closing buyer and supplier disputes.',
  startHere: [
    'Find the exact STEM and open its dispute record.',
    'Read the current status and Next Action before changing anything.',
    'Refresh first if Salesforce or another user may have changed the case.',
  ],
  tasks: [
    {
      title: 'Open or update a dispute',
      summary: 'Record what happened, the affected party, amount, and required commercial action.',
      steps: [
        'Select the exact buyer or supplier side and confirm the Account shown for the STEM.',
        'Choose the action that reflects the agreed commercial treatment.',
        'Enter the currency, amount, explanation, and any invoice allocation requested by the form.',
        'Attach supporting evidence when the action requires it, then save the draft.',
      ],
    },
    {
      title: 'Submit and review an approval',
      summary: 'Move a complete instruction to its authorized reviewer.',
      steps: [
        'Resolve every validation message shown on the case.',
        'Review the action, party, amount, currency, and supporting documents.',
        'Submit the instruction for approval.',
        'The reviewer approves it or returns it with a clear revision reason.',
      ],
    },
    {
      title: 'Complete the accounting step',
      summary: 'Record the final accounting treatment and evidence after approval.',
      steps: [
        'Open an approved case waiting for Accounting.',
        'Record the accounting status and the final document or payment references.',
        'Confirm any balance-payment instruction and settlement amount.',
        'Save the accounting result so the case can advance to closure.',
      ],
    },
    {
      title: 'Close or reopen a case',
      summary: 'Close only after the approved commercial and accounting actions are complete.',
      steps: [
        'Confirm all required documents, settlements, and Accounting fields are complete.',
        'Select the correct closing reason and close the case.',
        'If later evidence requires more work, reopen the case with a specific reason.',
        'Follow the new Next Action instead of editing completed history directly.',
      ],
    },
  ],
  reminders: [
    'Salesforce invoices, credit notes, payments, and linked documents remain authoritative.',
    'Keep buyer and supplier amounts separate and never combine different currencies.',
    'Use Workflow Rules when you need the detailed responsibilities for each role and status.',
  ],
});

export const UNOFFICIAL_COMPENSATION_USER_MANUAL = Object.freeze({
  title: 'Unofficial Compensation',
  description: 'A practical guide to opening a compensation claim, recording recoveries, and monitoring the remaining amount.',
  startHere: [
    'Search for the exact active Account and review any existing claims.',
    'Use Open Claim only when a new agreement needs to be recorded.',
    'Keep each currency separate throughout the claim and recovery process.',
  ],
  tasks: [
    {
      title: 'Open a compensation claim',
      summary: 'Record the agreed amount, responsible person, deadline, and reason.',
      steps: [
        'Select the exact Account and, when applicable, the exact Contact.',
        'Enter the agreed amount, currency, deadline, person in charge, and description.',
        'Review the outstanding amount and validation messages.',
        'Save the claim.',
      ],
    },
    {
      title: 'Update an active claim',
      summary: 'Keep ownership, deadline, and progress information current.',
      steps: [
        'Open the Account group and select the claim.',
        'Review the agreed amount, recorded recoveries, and remaining balance.',
        'Update the deadline, person in charge, or description when the agreement changes.',
        'Save and confirm the refreshed outstanding amount.',
      ],
    },
    {
      title: 'Record a recovery',
      summary: 'Link recovered value to the exact STEM evidence.',
      steps: [
        'Choose the claim and search for the exact STEM or line item.',
        'Select fixed or unit-price treatment and enter the requested amount.',
        'Check that the recovery uses the same currency and does not exceed the remaining claim.',
        'Save the recovery and review the revised outstanding amount.',
      ],
    },
    {
      title: 'Finish or correct a claim',
      summary: 'Close completed work and correct only eligible records.',
      steps: [
        'Confirm the remaining amount is correct and all recoveries are linked.',
        'Complete the claim using the available status action.',
        'Delete or amend a record only when your role permits it and no protected evidence would be lost.',
        'Refresh after any Salesforce correction before continuing.',
      ],
    },
  ],
  reminders: [
    'Blank or inactive Salesforce identities may prevent selection until the source data is corrected.',
    'Do not net different currencies or use an approximate STEM match.',
    'A disabled action normally means required evidence, permission, or a valid current revision is missing.',
  ],
});

export const VARIABLE_CHARGES_USER_MANUAL = Object.freeze({
  title: 'Variable Charges',
  description: 'A role-based guide to confirming supplier costs, approving buyer charges, and making invoices ready.',
  startHere: [
    'Open My Tasks and choose the STEM showing an action for you.',
    'Check the Supplier Leg or Buyer Leg assigned to you.',
    'Resolve every Pending charge before submitting your review.',
  ],
  tasks: [
    {
      title: 'Confirm supplier costs',
      summary: 'Supplier Traders review one exact supplier at a time.',
      steps: [
        'Select the supplier shown in the Supplier Leg.',
        'For every charge, choose Pending, Correct, or Edit Cost.',
        'If editing an extra charge, enter the permitted cost fields and save the change. Existing product lines must be edited in Salesforce.',
        'Enter one Review Note and choose Approve Supplier Costs when no rows remain Pending.',
      ],
    },
    {
      title: 'Approve buyer charges',
      summary: 'Buyer Traders decide which reviewed costs are charged to the buyer.',
      steps: [
        'Review Total Supplier Cost, Total Buyer Charge, and Total Margin.',
        'For every charge, choose Pending, Charge Buyer, or Do Not Charge.',
        'Enter or amend the permitted buyer price in USD when required.',
        'Enter one Review Note and choose Approve Buyer Charges when no rows remain Pending.',
      ],
    },
    {
      title: 'Review Hong Kong statutory charges',
      summary: 'Save the evidence needed for Anchorage Dues, Light Dues, and Basic Calling Cost support rows.',
      steps: [
        'Confirm or save the Vessel NRT when the statutory calculation requires it.',
        'Enter the requested anchorage period, location, Light Dues details, or Port Clearance Extension application count.',
        'Review the supplier statutory HKD amount and USD equivalent, then review the separate buyer default calculated at USD 0.002 per NRT-hour.',
        'Save the statutory evidence separately before approving the affected charge row.',
      ],
      note: 'The statutory calculation verifies the charge. It does not overwrite a reviewed supplier or buyer financial amount automatically.',
    },
    {
      title: 'Add or correct a charge',
      summary: 'Create only the missing charge for the exact supplier.',
      steps: [
        'Choose Add Charge in the Supplier Leg.',
        'Select the actual Product and enter a useful description.',
        'Choose Fixed or Per Unit and complete quantity and UOM when required.',
        'Enter the supplier cost first; the Buyer Leg remains Pending until its owner makes a decision.',
      ],
    },
    {
      title: 'Make invoices ready',
      summary: 'Complete each required supplier review before the final buyer approval.',
      steps: [
        'Confirm each required supplier independently; this unlocks only that supplier invoice.',
        'Complete the Buyer Leg after all required supplier reviews are approved.',
        'If you own both legs, use Approve Both only after both notes and all row decisions are complete.',
        'If an invoice already exists, follow the red action-required panel instead of changing history silently.',
      ],
    },
  ],
  reminders: [
    'Pending always blocks approval.',
    'Refresh after editing a product line or other source record in Salesforce.',
    'A General Manager review requires a specific reason and does not replace the original trader assignment.',
    'Use the Review Starts information icon for the detailed timing rules.',
  ],
});

export const SPECIAL_TERMS_USER_MANUAL = Object.freeze({
  title: 'Special Terms',
  description: 'A practical guide to creating, reviewing, publishing, and reusing controlled contractual terms.',
  startHere: [
    'Search for the exact term and read its status and Next Action.',
    'Use New Special Term only when the clause set does not already exist.',
    'Edit and publish the complete term as one controlled revision.',
  ],
  tasks: [
    {
      title: 'Create a special term',
      summary: 'Start a draft and choose where the approved wording may appear.',
      steps: [
        'Choose New Special Term and enter a clear unique name.',
        'Choose whether the term belongs in Confirmation, Nomination, or both.',
        'Create the draft, then open its editor.',
        'Add Terms Text, remarks, and clause rules before requesting approval.',
      ],
    },
    {
      title: 'Edit the complete revision',
      summary: 'Keep the wording and its document rules together.',
      steps: [
        'Open the term and review the current Salesforce revision.',
        'Edit Terms Text, clauses, remarks, PDF behavior, and any required change reason.',
        'Use N/A only when the selected field genuinely does not apply.',
        'Save the complete revision and resolve any validation or relink issue shown.',
      ],
    },
    {
      title: 'Review and publish',
      summary: 'Approve only the exact wording and document output you reviewed.',
      steps: [
        'Open Review & publish for a complete draft.',
        'Check the clause text, target documents, and available previews.',
        'Resolve every blocking validation message.',
        'Approve and publish the revision in one action.',
      ],
      note: 'A live or draft document preview is shown only when the Terms Text contains a clause for that document.',
    },
    {
      title: 'Use the Clause Library',
      summary: 'Reuse controlled clauses without creating duplicate wording.',
      steps: [
        'Open Clause Library and search by clause name or text.',
        'Review the clause status and usage before adding or changing it.',
        'Relink legacy content when FCOS identifies an exact controlled clause.',
        'Return to Special Terms and confirm the complete revision still reads correctly.',
      ],
    },
    {
      title: 'Export, inspect history, or delete',
      summary: 'Use the available evidence and remove only safe drafts.',
      steps: [
        'Download PDF or Word output when a review copy is needed.',
        'Open Salesforce or revision history to verify the authoritative record.',
        'Delete only an eligible Draft or Legacy record with no protected published use.',
        'Refresh after external changes before continuing work.',
      ],
    },
  ],
  reminders: [
    'Publishing is all-or-none; FCOS does not leave a partially published revision.',
    'Preserve genuinely customized wording and avoid creating near-duplicate clauses.',
    'Use Methodology for the detailed approval, relink, and document-generation rules.',
  ],
});

export const ACCOUNT_MANAGERS_USER_MANUAL = Object.freeze({
  title: 'Account Managers',
  description: 'A practical guide to maintaining Account ownership and flexible Buyer PIC reference tables.',
  startHere: [
    'Choose Account Managers for ownership or Buyer PIC References for human reference tables.',
    'Search for the exact active Salesforce Account or GROUP.',
    'Refresh first if Salesforce Account identity or status changed recently.',
  ],
  tasks: [
    {
      title: 'Find an Account or GROUP',
      summary: 'Use exact Salesforce identity while keeping same-name Accounts separate.',
      steps: [
        'Open Account Managers and search by Account name or CL Key.',
        'Use the role and manager filters to narrow the list.',
        'Check the GROUP context before editing a child Account.',
        'Open the exact row you intend to maintain.',
      ],
    },
    {
      title: 'Assign Account Managers',
      summary: 'Maintain up to the permitted number of responsible managers.',
      steps: [
        'Open the manager selector for the Account or GROUP.',
        'Choose the required active managers and remove any obsolete assignment.',
        'Review inherited GROUP behavior and any propagation choice shown.',
        'Save and confirm the updated names on the row.',
      ],
    },
    {
      title: 'Maintain an Account note',
      summary: 'Keep a concise operational note with the Account assignment.',
      steps: [
        'Open the Account note editor.',
        'Enter only current, useful ownership or coordination guidance.',
        'Choose propagation only when the same note genuinely applies to the child Accounts.',
        'Save and confirm the affected Account count.',
      ],
    },
    {
      title: 'Add or open a Buyer PIC Reference',
      summary: 'Create a flexible human-reference table for an active Buyer Account.',
      steps: [
        'Open Buyer PIC References and search the configured tables.',
        'Choose Add Account when the exact active Buyer is not configured.',
        'Search by Account name or CL Key and select the exact Salesforce identity.',
        'Open the reference table.',
      ],
    },
    {
      title: 'Design and edit a PIC table',
      summary: 'Adapt rows, columns, types, vessel categories, traders, and colors to the Account.',
      steps: [
        'Choose Edit table, then rename headers or add and remove rows and columns.',
        'Choose the appropriate input type: free text, multi-text, checkbox, number, Buyer Trader, or Supplier Trader.',
        'Use Add vessel type for flexible vessel-category columns.',
        'Save the table, then use Row colours to add readable conditional highlighting.',
      ],
    },
    {
      title: 'Import or export a PIC table',
      summary: 'Exchange the current table structure without turning it into routing logic.',
      steps: [
        'Export CSV to obtain the current headers and row format.',
        'Edit the CSV without changing the meaning of configured input types.',
        'Choose Import matching CSV and review the replacement preview.',
        'Confirm the import and verify multiline cells, order, and colors after saving.',
      ],
    },
  ],
  reminders: [
    'Buyer PIC References are human reference only; they do not route work or change Salesforce.',
    'Inactive, supplier-only, broker-only, and GROUP records cannot receive a Buyer PIC table.',
    'If another user saved first, refresh the latest revision before retrying your change.',
  ],
});
