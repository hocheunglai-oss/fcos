# Xero reconciliation exceptions

The portal separates identity conflicts, reviewable legacy differences, and matches.
All Xero financial writes still require the existing Finance review and external-action gate.
Salesforce access remains read-only.

## Shared Contacts

Multiple Salesforce Account IDs may legitimately resolve to one active Xero Contact.
Each source must independently resolve to exactly one active contact by its Account
name or CL Key. Identical Salesforce full names are shown as a shared-contact warning,
with both Account IDs and CL Keys, rather than an unconditional rejection. Finance
must review the exact document before a new shared-contact link or update. This does
not merge Salesforce Accounts or approve every future transaction for those Accounts.
Different Account names cannot rely on date and amount alone; an exclusive document
number, STEM reference, or previously reviewed unchanged Account identity is required.

Matching precedence is saved document link, exact invoice number, full STEM token,
then unique Contact/currency/amount/date evidence. Saved-link/number contradictions
block. Buyer document numbers retain global collision checks; supplier numbers are
scoped to their Contact. Two sources cannot claim one Xero document. An exclusive
stronger document claim is retained while weaker competing claims remain blocked;
a rejected claim never becomes a new draft automatically. Potential legacy matches
without supporting dates/STEM evidence require resolution before creating another draft.

## Protected history

Paid, allocated, and locked records remain protected from modification. When document
identity, totals, currency, approved account/tax codes, and each economic line agree,
Finance can explicitly accept retained numbering, date, reference, or description
differences as a **link-only** action. No Xero invoice POST occurs for that action.
The portal displays **Accepted legacy** separately from exact matches and retains
all differences. Changed evidence requires renewed review. Changed coding, taxes,
line amounts, duplicate lines, or incomplete mapping evidence remain exceptions.
Line order and incidental whitespace alone do not create false differences.

Accepted evidence and Salesforce Account identity are stored in the existing private
mapping JSON, with the existing reviewed run/audit trail and revision controls. No
schema migration or permission expansion is required. Existing cached checks are
versioned; after this release, run **Check everything** to build a fresh review.
Selections from old classifications cannot authorize a changed transaction.

## Payments

Both saved and new allocations re-read the invoice identity, Contact, currency,
status and Salesforce source relationship. Matching uses invoice ID, exact amount
in cents, valid calendar date, bank and payment reference together. Equal payments
on the same day can match separately when bank/reference distinguish them.
Near matches, deleted payments, competing ownership and missing evidence remain
blocked rather than permitting a duplicate payment. Refunds and unsupported
adjustments are not converted into positive cash payments. Selected allocations
cannot exceed the current invoice balance in aggregate.

Old payment fingerprints are upgraded only after the refreshed document Account
identity and all current payment evidence pass. This upgrade saves reconciliation
evidence only; it does not post another Xero payment.
