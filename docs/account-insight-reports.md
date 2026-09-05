# Account Insight and reports

Account Insight opens over the existing Dashboard. Its period controls apply to trading activity; current exposure uses the separately displayed Salesforce timestamp. Both keeps buyer and supplier figures separate. GROUP child selection applies to the sections and report, while the full GROUP hierarchy remains the source of credit authority.

## Build a report

1. Select **Build report** and an Internal, Buyer-facing or Supplier-facing audience.
2. Check the Account, GROUP children, direction, trading period and statement scope.
3. Choose sections and their order. Summary is the default; Detailed enables selected columns and complete or selected STEM evidence.
4. Select **Build PDF**. Check the actual paginated preview, then select **Download PDF** for that same document.

Personal presets save presentation choices only. Administrators and the uniquely active General Manager may publish company presets. Saving an existing preset requires its current revision; archived presets retain audit history. No Account, reporting date, financial snapshot or PDF is stored in presets.

Buyer-facing and supplier-facing reports are server-restricted to their own direction. Internal profit, opposite-leg amounts, credit limits, modeled forecasts, internal notes and strategies cannot be added through a modified request or preset. Expected activity is optional and off by default. Reports are download-only; FCOS sends no email and creates no public share link.

## Evidence and limits

- Payment allocations are counted once; a supporting remittance is not another receipt. Voided, unrelated and unreliable legacy payments are excluded.
- Fixed charges retain fixed fields and saved currency evidence. Range-maximum expected invoices remain distinct from Salesforce exposure and ordinary trading amounts.
- Missing amounts remain unavailable. Currencies are never summed together.
- Detailed reports retrieve the full filtered evidence rather than the visible page. The current safety limit is 2,000 detail rows and 500 individually selected STEMs. Exceeding a limit produces an explicit error; no partial report is downloaded.
- Pre-2026 commercial history remains available. Earlier settled payment details remain unavailable and do not enter payment metrics or credit forecasts.

Only report presets and redacted audit metadata use Supabase. Salesforce remains authoritative; this release makes no Salesforce writes.
