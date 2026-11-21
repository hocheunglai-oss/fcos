# Hong Kong Trading FX

This guide describes the Trading FX behavior in FCOS source `01ae784a`, verified live on 22 November 2026 Hong Kong time. Provider settings and permission assignments require current readback before operational use.

## Pricing and Salesforce access

- The STEM and Quote principal currency is USD. Trading FX records Buy and Sell currency independently through [the trade-side metadata](../force-app/main/default/objects/Trade_Currency_Side__c/Trade_Currency_Side__c.object-meta.xml). The [currency service](../force-app/main/default/classes/FcosTradeCurrencyService.cls) permits HKD only for eligible fixed-price Hong Kong delivery. HKD-native amounts retain the reviewed rate revision and effective time alongside their USD equivalents.
- The [company rate service](../force-app/main/default/classes/FcosCompanyFxRateService.cls) verifies the signed response and binds confirmation to the reviewed rate ID. The [currency guard](../force-app/main/default/classes/FcosTradeCurrencyGuard.cls) checks persisted HKD side and row evidence together. An amendment requires the specific amendment permission and a recorded reason.
- The currency service checks the Trading FX setting and the entry permission before writing. The [permission-set definitions](../force-app/main/default/permissionsets/) distinguish data access, entry, amendment and settlement. Verify the assigned permission sets and effective object and field access for the intended user. The release’s correction verified the removal of the targeted direct Sales Support profile grant.

## Xero drafts, payments and prepayments

| Action | Source controls |
| --- | --- |
| Native Trading FX draft or HKD payment | The [external action gates](../api/_externalActionGates.js) require both `FCOS_ENABLE_XERO_FINANCIAL_SYNC` and `FCOS_ENABLE_XERO_TRADING_FX_WRITES`. Both flags default off in source. [Draft creation](../api/_xeroNativeDocumentActions.js) and [payment posting](../api/_xeroPaymentPosting.js) enforce the gate at the operation. |
| Standalone native HKD payment | The [payment identity](../api/_xeroPaymentIdentity.js) and [financial sync service](../api/_xeroFinancialSync.js) require exact HKD document, FX and approved bank evidence. The reviewed standalone path accepts an eligible USD or HKD bank account and applies the amount rules for that currency. |
| Prepayment | The [prepayment service](../api/_xeroPrepayments.js) requires an explicit review, exact operation ID and fingerprint, a writable deployment, the financial-sync gate and `FCOS_ENABLE_XERO_PREPAYMENTS`. The [currency check](../api/_xeroPrepaymentCurrency.js) requires matching cash-event, agreed-trade and active Xero bank-account currencies. |

Review the exact business evidence, provider organisation, bank account and scoped authority before a financial operation. Use the original-operation readback for an uncertain result and preserve its durable evidence.

## Release and test evidence

Trading FX cutover run `43773922006` promoted the reviewed package through DEVEE, the verified mirror, QAT and Salesforce Production, then verified the FCOS deployment. The live observation lasted 302.026 seconds with zero business writes. Later changes carry the guarded Editors behavior into the current application. [Trading FX cutover](https://github.com/hocheunglai-oss/fcos/actions/runs/43773922006) · [Verified Dashboard source](https://github.com/hocheunglai-oss/fcos/actions/runs/44923033791)

The isolated Xero Demo qualification on 13 November 2026 UTC covered 15 checks on candidate `77faf363`. It covered buyer and supplier invoice and credit drafts, native HKD payments, draft and payment recovery, prepayment creation and lifecycle checks, and full credit allocation and recovery. This evidence applies to the recorded test company, candidate and cases. For a new release, bind provider qualification to the exact candidate and use the [protected release workflow](rapid-release.md).
