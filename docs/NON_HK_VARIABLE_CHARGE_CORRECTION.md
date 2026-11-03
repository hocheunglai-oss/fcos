# Non-Hong Kong Variable Charge Correction

## Final behavior

- Variable charges outside Hong Kong are entered, displayed, reviewed, and saved in USD. This also applies when the supplier is an agent whose Account has a blank or HKD agency-fee currency.
- Historical native-currency evidence remains available as recorded evidence, but it does not replace the stored USD financial amount for a non-Hong Kong charge.
- Hong Kong statutory rules, labels, calculated defaults, and Basic Calling support bundles apply only to Hong Kong deliveries. A similarly named product outside Hong Kong remains an ordinary USD charge and keeps its actual Salesforce product name.
- Existing Hong Kong behavior remains unchanged, including reviewed USD/HKD conversion evidence, company-rate revision checks, and stale-review rejection.

## Historical audit and repair policy

The correction audit covers all historical rows that contain managed-bundle, bundle-key, or HKD-input evidence. It does not limit discovery to recent or currently displayed work.

Automatic repair is deliberately narrower. A row may be cancelled only when every condition below is proven from a fresh, target-locked read:

- it is an active, system-generated Hong Kong Basic Calling support row attached to a delivery outside Hong Kong;
- its bundle key and source identify the exact same STEM and supplier, and the source is an active Basic Calling Cost;
- it has no buyer or supplier invoice; and
- every supplier and buyer financial amount is null or zero.

Manual rows, invoiced rows, rows with non-zero financial amounts, unknown ports, invalid source relationships, duplicate active bundle keys, and non-managed HKD rows block execution for review. The approved repair plan is hash-bound to exact record identities and timestamps and is re-read before execution.

Repair performs a sparse cancellation only. It does not delete records or rewrite supplier costs, buyer prices, totals, native evidence, or exchange-rate evidence. It invalidates any affected existing review so changed financial scope must be reviewed again; it never creates or restores an approval automatically.

## Verification

Focused Node tests cover non-Hong Kong USD input and rendering, agent behavior, same-name statutory products, Hong Kong rate and statutory behavior, approval reconciliation, and the fail-closed repair plan. The Apex coverage verifies that non-Hong Kong deliveries neither create nor repopulate managed support rows, invoice-linked rows are preserved, actual cleanup invalidates both review sides, and no-op synchronization preserves a verified review.

Release verification must use the repository's durable Salesforce workflow:

1. Validate and deploy the complete owned metadata tree in DEVEE, with all required local tests passing.
2. Publish the byte-equivalent DEVEE source to the shared Salesforce repository through an open draft pull request and verify the mirror.
3. Promote the same proven source to QAT and complete its tests.
4. Promote the same proven source to Production and complete its tests.

Each stage must retain its exact source hash and Salesforce job IDs. A failure stops promotion; an unchanged source resumes from the failed stage rather than repeating successful upstream validation.

## Separate HKD workflow

The broader Hong Kong dual-currency, deposit, and proforma workflow remains preserved in separate development work. This hotfix does not publish, activate, or claim deployment of that unfinished workflow.
