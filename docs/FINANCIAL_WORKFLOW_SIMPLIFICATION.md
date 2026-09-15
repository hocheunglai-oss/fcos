# Financial workflow simplification (2.0.212)

A Finance user can open the last completed Salesforce–Xero check, fix a mapping on its exception row, then review and sync selected documents in one confirmation. Exact existing transactions are linked in FCOS without posting to Xero. Needs attention, Ready to sync, Waiting and Matched separate actionable work from invoice dependencies.

## Review and recovery

The combined action invokes the existing authorisation RPC before the guarded run. Before posting, it reloads Salesforce, Xero and approved mappings and compares each selected record's financial fingerprint. Changed records require review again; unaffected records proceed. Successful item checkpoints and idempotency keys remain in use on resume. A connection failure after authorisation leaves a resumable run. Duplicate target identities are exceptions before automatic linking.

Completed previews persist document and payment results together. Returning to the page checks modified source records and Xero changes since the last full snapshot. A manual check, an old-format snapshot, or a snapshot older than six hours forces complete retrieval, including hard deletions. A write always performs fresh validation. Retrieval limits fail explicitly instead of silently producing incomplete totals. Stored FCOS mappings and items are paginated, and automatic exact links are saved in batches.

## Disputes

The visible stages are Prepare, Approve, Settle and Closed; existing database states and audit events remain intact. Each selected Account and role has an agreement card. Submission saves the complete agreement. Notes reuse the agreement summary; reasons for revision, rejection, exceptions and accepting an external closure remain explicit.

Finance can select existing evidence only after the server verifies the same Account, STEM, invoice, amount and currency. Supported suggestions include exact Salesforce supplier refunds, posted Xero credits backed by Salesforce documents, and a single exact credit allocation to a supplier invoice. Ambiguous or combined allocations remain manual. Saving revalidates the evidence fingerprint; no additional cash, invoice, credit or refund is created by the dispute workflow.

The final required settlement can be recorded and closed in one action. The existing closure checks still run. If settlement succeeds but closure fails, the response preserves the successful settlement and explains that closure is pending. Approve and close is narrower: all selected roles must have closing outcomes, every affected balance must be verified as zero, and no credit, recovery, compensation claim or supplier instruction may remain. This action requires both approval and accounting permission and rechecks balances before closure.

Reconciliation shows the current FCOS dispute status and links to the same STEM. Disputes link back to its reconciliation and use existing Salesforce/Xero evidence. Salesforce remains authoritative for its business records and high-level dispute status.

## Release verification

Use local synthetic fixtures for posting and closure interactions. Never send customer emails or post production transactions during verification. The financial write gate retains its existing value. No Salesforce metadata or Supabase schema migration is required for this change. Deploy through the exact-SHA protected FCOS release process, preserving the 2.0.211 production baseline.
