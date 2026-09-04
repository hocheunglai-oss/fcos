public without sharing class VariableChargeInvoiceReadinessService {
    public static final String FCOS_URL_PREFIX = 'https://fcos.fcuno.com/payment-collections?tab=variable-charges&stemId=';
    public static final Date STEM_CREATED_FROM = Date.newInstance(2026, 1, 1);
    private static final Decimal ANCHORAGE_BUYER_RATE_USD = 0.002;
    private static final String ANCHORAGE_BUYER_CALCULATION_VERSION = 'hk-buyer-nrt-hour-2026-v1';
    private static Boolean invalidationInProgress = false;

    public class Readiness {
        @AuraEnabled public Boolean ready { get; set; }
        @AuraEnabled public Boolean requiresVariableChargeReview { get; set; }
        @AuraEnabled public String reason { get; set; }
        @AuraEnabled public String fcosUrl { get; set; }
        @AuraEnabled public Id stemId { get; set; }
        @AuraEnabled public Id supplierId { get; set; }
        @AuraEnabled public Boolean deliveryRequired { get; set; }
        @AuraEnabled public String actionBasis { get; set; }
        @AuraEnabled public Date actionBasisDate { get; set; }
        @AuraEnabled public Date actionableOn { get; set; }

        public Readiness(Boolean ready, Boolean required, String reason, Id stemId, Id supplierId) {
            this.ready = ready;
            this.requiresVariableChargeReview = required;
            this.reason = reason;
            this.stemId = stemId;
            this.supplierId = supplierId;
            this.fcosUrl = stemId == null ? null : FCOS_URL_PREFIX + String.valueOf(stemId);
        }
    }

    public class Actionability {
        public Boolean hasProductLineItems;
        public Boolean deliveryRequired;
        public String actionBasis;
        public Date actionBasisDate;
        public Date actionableOn;
        public Boolean ready;
    }

    private class SupplierContext {
        public STEM__c stem;
        public Account supplier;
        public STEM_Variable_Charge_Supplier__c stage;
        public Boolean exactSupplier;
        public Boolean required;
        public Boolean hasProductLineItems;
    }

    @TestVisible
    private static Boolean isVariableChargeAccount(Account account) {
        return account != null && (account.Is_Agent__c == true || account.Is_Variable__c == true);
    }

    @AuraEnabled(cacheable=false)
    public static Readiness getBuyerReadiness(String stemId) {
        Id parsedStemId = safeId(stemId);
        if (parsedStemId == null) return blocked('Select a valid STEM before checking invoice readiness.', null, null, true);
        try {
            return evaluateBuyer(parsedStemId);
        } catch (Exception ex) {
            return blocked('Invoice readiness could not be checked. Refresh, then open the FCOS task if the problem continues.', parsedStemId, null, true);
        }
    }

    @AuraEnabled(cacheable=false)
    public static Readiness getSupplierReadiness(String stemId, String supplierId) {
        Id parsedStemId = safeId(stemId), parsedSupplierId = safeId(supplierId);
        if (parsedStemId == null || parsedSupplierId == null) {
            return blocked('A valid STEM and exact Supplier Account are required.', parsedStemId, parsedSupplierId, true);
        }
        try {
            return evaluateSupplier(parsedStemId, parsedSupplierId);
        } catch (Exception ex) {
            return blocked('Supplier Invoice readiness could not be checked. Refresh, then open the FCOS task if the problem continues.', parsedStemId, parsedSupplierId, true);
        }
    }

    public static Readiness evaluateSupplier(Id stemId, Id supplierId) {
        SupplierContext context = loadSupplierContext(stemId, supplierId);
        if (context == null || context.stem == null) return blocked('The STEM could not be found.', stemId, supplierId, true);
        if (context.exactSupplier != true) return blocked('The selected Account is not an active exact supplier on this STEM.', stemId, supplierId, true);
        if (context.required != true) return new Readiness(true, false, null, stemId, supplierId);
        Actionability actionability = calculateActionability(context.stem, context.hasProductLineItems);
        if (actionability.ready != true) {
            return blockedForActionability(actionability, stemId, supplierId, true);
        }
        String currencyProblem = agentCurrencyProblem(stemId, supplierId);
        if (String.isNotBlank(currencyProblem)) return blocked(currencyProblem, stemId, supplierId, true);
        String bundleProblem = hongKongBundleProblem(stemId, supplierId, true);
        if (String.isNotBlank(bundleProblem)) return blocked(bundleProblem, stemId, supplierId, true);
        String anchorageProblem = hongKongAnchorageProblem(stemId, supplierId, true);
        if (String.isNotBlank(anchorageProblem)) return blocked(anchorageProblem, stemId, supplierId, true);
        if (context.stage == null || context.stage.Supplier_Status__c != 'Verified') {
            return blocked('Confirm ' + context.supplier.Name + ' costs in FCOS before creating this Supplier Invoice.', stemId, supplierId, true);
        }
        String currentFingerprint = supplierFingerprint(stemId, supplierId);
        if (String.isBlank(context.stage.Reviewed_Source_Fingerprint__c)
            || context.stage.Reviewed_Source_Fingerprint__c != currentFingerprint) {
            return blocked(context.supplier.Name + ' costs changed. Confirm them again in FCOS before creating this Supplier Invoice.', stemId, supplierId, true);
        }
        return withActionability(new Readiness(true, true, null, stemId, supplierId), actionability);
    }

    public static Readiness evaluateTaskActionability(Id stemId) {
        List<STEM__c> stems = [
            SELECT Id, CreatedDate, Delivery_Date__c,
                ETA_Start_Date__c, ETA_End_Date__c, ETB_Start_Date__c, ETB_End_Date__c,
                ETCD_Start_Date__c, ETCD_End_Date__c, ETD_Start_Date__c, ETD_End_Date__c,
                (SELECT Id FROM STEM_Line_Items__r WHERE Cancelled__c = false LIMIT 1)
            FROM STEM__c WHERE Id = :stemId LIMIT 1
        ];
        if (stems.isEmpty()) return blocked('The STEM could not be found.', stemId, null, true);
        STEM__c stem = stems[0];
        if (stem.CreatedDate.date() < STEM_CREATED_FROM) return new Readiness(true, false, null, stemId, null);
        Actionability actionability = calculateActionability(stem, !stem.STEM_Line_Items__r.isEmpty());
        return actionability.ready == true
            ? withActionability(new Readiness(true, true, null, stemId, null), actionability)
            : blockedForActionability(actionability, stemId, null, true);
    }

    public static Readiness evaluateBuyer(Id stemId) {
        List<STEM__c> stems = [
            SELECT Id, CreatedDate, Delivery_Date__c,
                ETA_Start_Date__c, ETA_End_Date__c, ETB_Start_Date__c, ETB_End_Date__c,
                ETCD_Start_Date__c, ETCD_End_Date__c, ETD_Start_Date__c, ETD_End_Date__c,
                Variable_Charges_Confirmed__c,
                (SELECT Original_Supplier__c, Original_Supplier__r.Is_Agent__c,
                    Original_Supplier__r.Is_Variable__c,
                    Original_Supplier__r.Inactive_Suspended__c
                 FROM STEM_Line_Items__r
                 WHERE Cancelled__c = false),
                (SELECT Supplier__c, Supplier__r.Is_Agent__c,
                    Supplier__r.Is_Variable__c,
                    Supplier__r.Inactive_Suspended__c
                 FROM STEM_Extra_Costs__r
                 WHERE Cancelled__c = false AND Supplier__c != null),
                (SELECT Supplier__c, Manual_Review_Required__c
                 FROM Variable_Charge_Suppliers__r)
            FROM STEM__c WHERE Id = :stemId LIMIT 1
        ];
        if (stems.isEmpty()) return blocked('The STEM could not be found.', stemId, null, true);
        STEM__c stem = stems[0];
        if (stem.CreatedDate.date() < STEM_CREATED_FROM) return new Readiness(true, false, null, stemId, null);
        Boolean hasProductLineItems = !stem.STEM_Line_Items__r.isEmpty();
        Set<Id> exactIds = new Set<Id>();
        Set<Id> requiredIds = new Set<Id>();
        for (STEM_Line_Item__c lineItem : stem.STEM_Line_Items__r) {
            if (lineItem.Original_Supplier__c == null) continue;
            if (lineItem.Original_Supplier__r?.Inactive_Suspended__c == true) continue;
            exactIds.add(lineItem.Original_Supplier__c);
            if (isVariableChargeAccount(lineItem.Original_Supplier__r)) requiredIds.add(lineItem.Original_Supplier__c);
        }
        for (STEM_Extra_Cost__c extraCost : stem.STEM_Extra_Costs__r) {
            if (extraCost.Supplier__r?.Inactive_Suspended__c == true) continue;
            exactIds.add(extraCost.Supplier__c);
            if (isVariableChargeAccount(extraCost.Supplier__r)) requiredIds.add(extraCost.Supplier__c);
        }
        for (STEM_Variable_Charge_Supplier__c stage : stem.Variable_Charge_Suppliers__r) {
            if (stage.Manual_Review_Required__c == true && exactIds.contains(stage.Supplier__c)) requiredIds.add(stage.Supplier__c);
        }
        if (requiredIds.isEmpty()) return new Readiness(true, false, null, stemId, null);
        Actionability actionability = calculateActionability(stem, hasProductLineItems);
        if (actionability.ready != true) {
            return blockedForActionability(actionability, stemId, null, true);
        }
        for (Id supplierId : requiredIds) {
            Readiness buyerSideReadiness = evaluateBuyerSupplier(stemId, supplierId);
            if (buyerSideReadiness.ready != true) return buyerSideReadiness;
        }
        if (stem.Variable_Charges_Confirmed__c != true) {
            return blocked('Approve buyer charges in FCOS before creating the final Buyer Invoice.', stemId, null, true);
        }
        return withActionability(new Readiness(true, true, null, stemId, null), actionability);
    }

    public static Readiness evaluateBuyerSupplier(Id stemId, Id supplierId) {
        SupplierContext context = loadSupplierContext(stemId, supplierId);
        if (context == null || context.stem == null) return blocked('The STEM could not be found.', stemId, supplierId, true);
        if (context.exactSupplier != true) return blocked('The selected Account is not an active exact supplier on this STEM.', stemId, supplierId, true);
        if (context.required != true) return new Readiness(true, false, null, stemId, supplierId);
        Actionability actionability = calculateActionability(context.stem, context.hasProductLineItems);
        if (actionability.ready != true) return blockedForActionability(actionability, stemId, supplierId, true);
        String currencyProblem = agentCurrencyProblem(stemId, supplierId);
        if (String.isNotBlank(currencyProblem)) return blocked(currencyProblem, stemId, supplierId, true);
        String bundleProblem = hongKongBundleProblem(stemId, supplierId, false);
        if (String.isNotBlank(bundleProblem)) return blocked(bundleProblem, stemId, supplierId, true);
        String anchorageProblem = hongKongAnchorageProblem(stemId, supplierId, false);
        if (String.isNotBlank(anchorageProblem)) return blocked(anchorageProblem, stemId, supplierId, true);
        if (context.stage == null || context.stage.Buyer_Charge_Status__c != 'Verified') {
            return blocked('Confirm ' + context.supplier.Name + ' buyer charges in FCOS before creating the final Buyer Invoice.', stemId, supplierId, true);
        }
        String currentFingerprint = buyerChargeFingerprint(stemId, supplierId);
        if (String.isBlank(context.stage.Buyer_Charge_Reviewed_Source_Fingerprint__c)
            || context.stage.Buyer_Charge_Reviewed_Source_Fingerprint__c != currentFingerprint) {
            return blocked(context.supplier.Name + ' buyer charges changed. Confirm them again in FCOS before creating the final Buyer Invoice.', stemId, supplierId, true);
        }
        return withActionability(new Readiness(true, true, null, stemId, supplierId), actionability);
    }

    public static void assertFinalBuyerInvoiceAllowed(Id stemId) {
        Readiness readiness = evaluateBuyer(stemId);
        if (readiness.ready != true) throw messageException(readiness.reason);
    }

    public static Boolean hasFinalBuyerInvoice(Id stemId) {
        if (stemId == null) return false;
        for (Invoice__c invoice : [
            SELECT Id, Name, Proforma__c
            FROM Invoice__c
            WHERE STEM__c = :stemId
        ]) if (isFinalBuyerInvoice(invoice)) return true;
        return false;
    }

    public static Boolean hasSupplierInvoice(Id stemId, Id supplierId) {
        if (stemId == null || supplierId == null) return false;
        return [
            SELECT COUNT()
            FROM Supplier_Invoice__c
            WHERE STEM__c = :stemId AND Supplier__c = :supplierId
        ] > 0;
    }

    public static void assertPersistedInvoicesAllowed(Set<Id> invoiceIds) {
        if (invoiceIds == null || invoiceIds.isEmpty()) return;
        List<Invoice__c> invoices = [SELECT Id, Name, STEM__c, Proforma__c FROM Invoice__c WHERE Id IN :invoiceIds];
        if (invoices.size() != invoiceIds.size()) throw messageException('Final buyer invoice readiness could not be verified.');
        assertInvoiceRecordsAllowed(invoices);
    }

    public static void assertInvoiceRecordsAllowed(List<Invoice__c> invoices) {
        if (invoices == null) return;
        for (Invoice__c invoice : invoices) if (isFinalBuyerInvoice(invoice)) {
            assertFinalBuyerInvoiceAllowed(invoice.STEM__c);
            // Inserts cannot supply their own historical approval snapshot.
            if (invoice.Id == null) invoice.Buyer_Charge_Snapshot__c = null;
        }
    }

    public static void assertInvoiceTransitionsAllowed(Map<Id, Invoice__c> newMap, Map<Id, Invoice__c> oldMap) {
        if (newMap == null) return;
        for (Invoice__c invoice : newMap.values()) {
            Invoice__c oldInvoice = oldMap == null ? null : oldMap.get(invoice.Id);
            if (oldInvoice == null) assertInvoiceRecordsAllowed(new List<Invoice__c>{invoice});
            else BuyerInvoiceApprovalService.beforeUpdate(invoice, oldInvoice);
        }
    }

    public static void assertSupplierInvoiceTransitionsAllowed(List<Supplier_Invoice__c> newRecords, Map<Id, Supplier_Invoice__c> oldMap) {
        if (newRecords == null) return;
        for (Supplier_Invoice__c invoice : newRecords) {
            Supplier_Invoice__c oldInvoice = oldMap == null ? null : oldMap.get(invoice.Id);
            Boolean consequential = oldInvoice == null
                || invoice.STEM__c != oldInvoice.STEM__c
                || invoice.Supplier__c != oldInvoice.Supplier__c;
            if (!consequential || invoice.STEM__c == null || invoice.Supplier__c == null) continue;
            Readiness readiness = evaluateSupplier(invoice.STEM__c, invoice.Supplier__c);
            if (readiness.ready != true) invoice.addError(readiness.reason + ' ' + readiness.fcosUrl);
        }
    }

    public static void assertHongKongBundleConfirmationReady(Id stemId, Id supplierId, Set<String> sides) {
        if (sides == null || sides.isEmpty()) return;
        String currencyProblem = agentCurrencyProblem(stemId, supplierId);
        if (String.isNotBlank(currencyProblem)) throw messageException(currencyProblem);
        if (sides.contains('cost')) {
            String costProblem = hongKongBundleProblem(stemId, supplierId, true);
            if (String.isNotBlank(costProblem)) throw messageException(costProblem);
            String anchorageCostProblem = hongKongAnchorageProblem(stemId, supplierId, true);
            if (String.isNotBlank(anchorageCostProblem)) throw messageException(anchorageCostProblem);
        }
        if (sides.contains('buyer_charge')) {
            String buyerProblem = hongKongBundleProblem(stemId, supplierId, false);
            if (String.isNotBlank(buyerProblem)) throw messageException(buyerProblem);
            String anchorageBuyerProblem = hongKongAnchorageProblem(stemId, supplierId, false);
            if (String.isNotBlank(anchorageBuyerProblem)) throw messageException(anchorageBuyerProblem);
        }
    }

    private static String agentCurrencyProblem(Id stemId, Id supplierId) {
        List<Account> suppliers = [
            SELECT Id, Is_Agent__c, Agency_Fee_Currency__c
            FROM Account WHERE Id = :supplierId LIMIT 1
        ];
        if (suppliers.isEmpty() || suppliers[0].Is_Agent__c != true) return null;
        String requiredCurrency = suppliers[0].Agency_Fee_Currency__c;
        if (requiredCurrency != 'USD' && requiredCurrency != 'HKD') {
            return 'Set the Agreed Agency Fee Currency on the supplier Account before reviewing its costs.';
        }
        for (STEM_Extra_Cost__c row : [
            SELECT Id, Product2Id__r.Name, Unit_Cost__c, Lumpsum_Cost__c,
                Supplier_Cost_Input_Currency__c, Supplier_Cost_Input_Value__c,
                Supplier_Cost_USD_HKD_Rate__c
            FROM STEM_Extra_Cost__c
            WHERE STEM__c = :stemId AND Supplier__c = :supplierId AND Cancelled__c = false
        ]) {
            Decimal storedUsd = row.Lumpsum_Cost__c != null ? row.Lumpsum_Cost__c : row.Unit_Cost__c;
            Decimal inputValue = row.Supplier_Cost_Input_Value__c;
            Decimal rate = row.Supplier_Cost_USD_HKD_Rate__c;
            String productName = displayProductName(row.Product2Id__r?.Name);
            if (row.Supplier_Cost_Input_Currency__c != requiredCurrency || inputValue == null
                || rate == null || rate <= 0 || storedUsd == null) {
                return productName + ' must be reviewed in the supplier Account\'s agreed ' + requiredCurrency + ' currency.';
            }
            Decimal expectedUsd = (requiredCurrency == 'HKD' ? inputValue / rate : inputValue).setScale(2);
            if ((storedUsd - expectedUsd).abs() > 0.005) {
                return productName + ' no longer reconciles to its reviewed ' + requiredCurrency + ' supplier cost.';
            }
        }
        return null;
    }

    private static String displayProductName(String value) {
        String normalized = normalizeProductName(value);
        return normalized == HongKongBasicCallingBundleService.LEGACY_PORT_CLEARANCE_FEE
            ? HongKongBasicCallingBundleService.PORT_CLEARANCE_EXTENSION
            : (String.isBlank(value) ? 'Supplier charge' : value);
    }

    private static String hongKongBundleProblem(Id stemId, Id supplierId, Boolean supplierSide) {
        List<STEM__c> stems = [
            SELECT Id, Port__r.Name, Port__r.Country__c
            FROM STEM__c WHERE Id = :stemId LIMIT 1
        ];
        if (stems.isEmpty() || !isHongKongPort(stems[0])) return null;
        List<STEM_Extra_Cost__c> rows = [
            SELECT Id, Product2Id__r.Name, Fixed__c, Quantity__c, Unit_Cost__c, Unit_Price__c,
                Lumpsum_Cost__c, Lumpsum_Price__c, Supplier_Cost_Input_Currency__c,
                Supplier_Cost_Input_Value__c, Supplier_Cost_USD_HKD_Rate__c,
                Port_Clearance_Rate_HKD__c, Port_Clearance_Calculation_Version__c
            FROM STEM_Extra_Cost__c
            WHERE STEM__c = :stemId AND Supplier__c = :supplierId
                AND Cancelled__c = false
        ];
        Boolean hasBasicCallingCost = false;
        for (STEM_Extra_Cost__c row : rows) {
            if (normalizeProductName(row.Product2Id__r?.Name) == HongKongBasicCallingBundleService.BASIC_CALLING_COST) {
                hasBasicCallingCost = true;
                break;
            }
        }
        if (!hasBasicCallingCost) return null;
        Account supplier;
        if (supplierSide) {
            supplier = [
                SELECT Id, Is_Agent__c, Agency_Fee_USD__c, Agency_Fee_Currency__c
                FROM Account WHERE Id = :supplierId LIMIT 1
            ];
        }
        for (STEM_Extra_Cost__c row : rows) {
            String productName = normalizeProductName(row.Product2Id__r?.Name);
            if (productName == HongKongBasicCallingBundleService.AGENCY_FEE) {
                if (supplierSide) {
                    String nativeCurrency = String.isBlank(supplier.Agency_Fee_Currency__c) ? 'USD' : supplier.Agency_Fee_Currency__c;
                    Decimal nativeAmount = supplier.Agency_Fee_USD__c;
                    if (nativeAmount == null || nativeAmount <= 0 || (nativeCurrency != 'USD' && nativeCurrency != 'HKD')
                        || row.Supplier_Cost_Input_Currency__c != nativeCurrency
                        || row.Supplier_Cost_Input_Value__c != nativeAmount
                        || row.Supplier_Cost_USD_HKD_Rate__c == null || row.Supplier_Cost_USD_HKD_Rate__c <= 0) {
                        return 'Set the Agreed Agency Fee and Currency on the supplier Account before approving Agency Fee.';
                    }
                    Decimal expectedUsd = nativeCurrency == 'HKD'
                        ? (nativeAmount / row.Supplier_Cost_USD_HKD_Rate__c).setScale(2)
                        : nativeAmount.setScale(2);
                    if (row.Lumpsum_Cost__c == null || (row.Lumpsum_Cost__c - expectedUsd).abs() > 0.005) {
                        return 'Agency Fee no longer matches the supplier Account’s Agreed Agency Fee and Currency.';
                    }
                }
                if (!supplierSide && row.Lumpsum_Price__c != null && row.Lumpsum_Price__c.abs() > 0.005) {
                    return 'Agency Fee is included in Basic Calling Cost and must remain USD 0 on the Buyer Leg.';
                }
            } else if (productName == HongKongBasicCallingBundleService.LIGHT_DUES) {
                if (!supplierSide && row.Lumpsum_Price__c != null && row.Lumpsum_Price__c.abs() > 0.005) {
                    return 'Light Dues are included in Basic Calling Cost and must remain USD 0 on the Buyer Leg.';
                }
            } else if (productName == HongKongBasicCallingBundleService.PORT_CLEARANCE_EXTENSION
                || productName == HongKongBasicCallingBundleService.LEGACY_PORT_CLEARANCE_FEE) {
                if (row.Quantity__c == null || row.Quantity__c < 1 || row.Quantity__c != row.Quantity__c.setScale(0)) {
                    return 'Enter the whole-number Port Clearance Extension count reported by the supplier.';
                }
                String requiredCurrency = supplierSide && supplier.Is_Agent__c == true
                    ? supplier.Agency_Fee_Currency__c
                    : 'HKD';
                Decimal supplierHkd = row.Quantity__c * HongKongBasicCallingBundleService.PORT_CLEARANCE_RATE_HKD;
                Decimal supplierTotalUsd = row.Supplier_Cost_USD_HKD_Rate__c != null
                    && row.Supplier_Cost_USD_HKD_Rate__c > 0
                    ? (supplierHkd / row.Supplier_Cost_USD_HKD_Rate__c).setScale(2)
                    : null;
                Decimal expectedNativeTotal = requiredCurrency == 'USD' ? supplierTotalUsd : supplierHkd;
                if (supplierSide && (row.Port_Clearance_Rate_HKD__c != HongKongBasicCallingBundleService.PORT_CLEARANCE_RATE_HKD
                    || row.Port_Clearance_Calculation_Version__c != HongKongBasicCallingBundleService.PORT_CLEARANCE_VERSION
                    || row.Supplier_Cost_Input_Currency__c != requiredCurrency
                    || row.Supplier_Cost_Input_Value__c != expectedNativeTotal
                    || row.Supplier_Cost_USD_HKD_Rate__c == null || row.Supplier_Cost_USD_HKD_Rate__c <= 0
                    || row.Fixed__c != true || row.Lumpsum_Cost__c == null
                    || (row.Lumpsum_Cost__c - supplierTotalUsd).abs() > 0.005)) {
                    return 'Confirm the supplier-reported Port Clearance Extension application count before approval.';
                }
                if (!supplierSide) {
                    if (row.Supplier_Cost_USD_HKD_Rate__c == null || row.Supplier_Cost_USD_HKD_Rate__c <= 0) {
                        return 'The Port Clearance Extension buyer pass-through rate is unavailable.';
                    }
                    Decimal buyerHkd = (row.Quantity__c - 1) * HongKongBasicCallingBundleService.PORT_CLEARANCE_RATE_HKD;
                    Decimal buyerTotalUsd = (buyerHkd / row.Supplier_Cost_USD_HKD_Rate__c).setScale(2);
                    Decimal buyerFixedCharge = row.Lumpsum_Price__c == null ? 0 : row.Lumpsum_Price__c;
                    if (row.Fixed__c != true || (buyerFixedCharge - buyerTotalUsd).abs() > 0.005) {
                        return row.Quantity__c == 1
                            ? 'The first port clearance is included in Basic Calling Cost and must remain USD 0.'
                            : 'Port Clearance Extensions must use the reviewed zero-margin buyer pass-through.';
                    }
                }
            }
        }
        return null;
    }

    private static String hongKongAnchorageProblem(Id stemId, Id supplierId, Boolean supplierSide) {
        List<STEM__c> stems = [
            SELECT Id, Port__r.Name, Port__r.Country__c
            FROM STEM__c WHERE Id = :stemId LIMIT 1
        ];
        if (stems.isEmpty() || !isHongKongPort(stems[0])) return null;
        for (STEM_Extra_Cost__c row : [
            SELECT Id, Product2Id__r.Name, Unit_Price__c, Lumpsum_Price__c,
                Anchorage_Dues_Allocation_HKD__c, Anchorage_NRT_Snapshot__c,
                Anchorage_USD_HKD_Rate__c, Anchorage_Calculation_Version__c,
                Anchorage_Buyer_Default_USD__c, Anchorage_Buyer_Rate_USD__c,
                Anchorage_Buyer_Calc_Version__c
            FROM STEM_Extra_Cost__c
            WHERE STEM__c = :stemId AND Supplier__c = :supplierId AND Cancelled__c = false
        ]) {
            String productName = normalizeProductName(row.Product2Id__r?.Name);
            if (productName != 'ANCHORAGE DUE' && productName != 'ANCHORAGE DUES') continue;
            if (supplierSide) {
                if (row.Anchorage_Calculation_Version__c == null
                    || row.Anchorage_Dues_Allocation_HKD__c == null
                    || row.Anchorage_Dues_Allocation_HKD__c < 0
                    || row.Anchorage_NRT_Snapshot__c == null || row.Anchorage_NRT_Snapshot__c <= 0
                    || row.Anchorage_USD_HKD_Rate__c == null || row.Anchorage_USD_HKD_Rate__c <= 0) {
                    return 'Save complete Hong Kong Anchorage Dues evidence before approving supplier costs.';
                }
            } else {
                Decimal buyerPrice = row.Lumpsum_Price__c != null ? row.Lumpsum_Price__c : row.Unit_Price__c;
                if (row.Anchorage_Buyer_Default_USD__c == null || row.Anchorage_Buyer_Default_USD__c < 0
                    || row.Anchorage_Buyer_Rate_USD__c == null
                    || (row.Anchorage_Buyer_Rate_USD__c - ANCHORAGE_BUYER_RATE_USD).abs() > 0.0000005
                    || row.Anchorage_Buyer_Calc_Version__c != ANCHORAGE_BUYER_CALCULATION_VERSION
                    || buyerPrice == null || buyerPrice < 0) {
                    return 'Save the USD 0.002 per NRT-hour Anchorage Dues buyer calculation before approving buyer charges.';
                }
            }
        }
        return null;
    }

    private static Boolean isHongKongPort(STEM__c stem) {
        String name = normalizeProductName(stem?.Port__r?.Name);
        String country = normalizeProductName(stem?.Port__r?.Country__c);
        return name == 'HONG KONG' || country == 'HONG KONG' || country == 'HK';
    }

    private static String normalizeProductName(String value) {
        return String.isBlank(value) ? '' : value.trim().replaceAll('\\s+', ' ').toUpperCase();
    }

    public static void assertBuyerConfirmationWriteAllowed(List<STEM__c> newRecords, Map<Id, STEM__c> oldMap) {
        if (newRecords == null || oldMap == null) return;
        Set<Id> confirmingIds = new Set<Id>();
        for (STEM__c stem : newRecords) {
            STEM__c oldStem = oldMap.get(stem.Id);
            if (oldStem != null && oldStem.Variable_Charges_Confirmed__c != true && stem.Variable_Charges_Confirmed__c == true) confirmingIds.add(stem.Id);
        }
        Set<Id> productBearingIds = productBearingStemIds(confirmingIds);
        for (STEM__c stem : newRecords) {
            STEM__c oldStem = oldMap.get(stem.Id);
            if (oldStem == null || oldStem.Variable_Charges_Confirmed__c == true || stem.Variable_Charges_Confirmed__c != true) continue;
            Actionability actionability = calculateActionability(stem, productBearingIds.contains(stem.Id));
            if (actionability.ready != true) {
                stem.addError(actionabilityReason(actionability));
                continue;
            }
            for (Id supplierId : requiredSupplierIds(stem.Id)) {
                Readiness readiness = evaluateBuyerSupplier(stem.Id, supplierId);
                if (readiness.ready != true) {
                    stem.addError(readiness.reason);
                    break;
                }
            }
        }
    }

    public static String supplierFingerprint(Id stemId, Id supplierId) {
        List<String> parts = new List<String>();
        Map<String, Object> binds = new Map<String, Object>{'stemId' => stemId, 'supplierId' => supplierId};
        parts.add('S|' + JSON.serialize(fingerprintRows(STEM__c.SObjectType, new List<String>{
            'Id','CreatedDate','Delivery_Date__c','ETA_Start_Date__c','ETA_End_Date__c',
            'ETB_Start_Date__c','ETB_End_Date__c','ETCD_Start_Date__c','ETCD_End_Date__c',
            'ETD_Start_Date__c','ETD_End_Date__c','CurrencyIsoCode'
        }, 'WHERE Id = :stemId LIMIT 1', binds)[0]));
        List<String> lineFields = new List<String>{
            'Id','Original_Supplier__c','Cancelled__c','Product__c','Payment_Term__c','Quantity__c',
            'Quantity_Delivered_Per_BDN__c','Quantity_Max__c','Unit_of_Measure__c',
            'Unit_Buy_At__c','Total_Cost__c','Commission_Cost__c','CurrencyIsoCode'
        };
        List<SObject> lineRows = fingerprintRows(STEM_Line_Item__c.SObjectType, lineFields,
            'WHERE STEM__c = :stemId AND Cancelled__c = false ORDER BY Id', binds);
        for (SObject row : lineRows) parts.add('P|' + String.valueOf(row.get('Id')));
        for (SObject row : fingerprintRows(Account.SObjectType,
            new List<String>{'Id','Is_Agent__c','Is_Variable__c','Supplier_Payment_Term__c','Agency_Fee_USD__c','Agency_Fee_Currency__c'},
            'WHERE Id = :supplierId', binds)) {
            parts.add('A|' + JSON.serialize(row));
        }
        for (SObject row : lineRows) if (row.get('Original_Supplier__c') == supplierId)
            parts.add('L|' + serializeProjection(row, lineFields));
        List<String> baseExtraFields = new List<String>{
            'Id','Supplier__c','Cancelled__c','Product2Id__c','Description__c','Payment_Term__c',
            'STEM_Line_Item__c','Quantity__c','Quantity_Delivered_Per_BDN__c','Quantity_Range_Max__c',
            'Unit_of_Measure__c','Unit_Cost__c','Lumpsum_Cost__c','Line_Total_Buy__c',
            'Supplier_Invoice__c','CurrencyIsoCode','Hong_Kong_Bundle_Key__c',
            'Hong_Kong_Bundle_Managed__c','Hong_Kong_Bundle_Sequence__c','Hong_Kong_Bundle_Source__c',
            'Port_Clearance_Rate_HKD__c','Port_Clearance_Calculation_Version__c'
        };
        List<SObject> extraRows = fingerprintRows(STEM_Extra_Cost__c.SObjectType, new List<String>{
            'Id','Supplier__c','Cancelled__c','Product2Id__c','Description__c','Payment_Term__c',
            'STEM_Line_Item__c','Quantity__c','Quantity_Delivered_Per_BDN__c','Quantity_Range_Max__c',
            'Unit_of_Measure__c','Unit_Cost__c','Lumpsum_Cost__c','Line_Total_Buy__c',
            'Supplier_Invoice__c','CurrencyIsoCode','Supplier_Cost_Input_Currency__c',
            'Supplier_Cost_Input_Value__c','Supplier_Cost_USD_HKD_Rate__c','Supplier_Cost_FX_Settings_Revision__c',
            'Anchorage_Arrival__c','Anchorage_Departure__c','Anchorage_Location__c',
            'Anchorage_Dues_Allocation_HKD__c','Anchorage_NRT_Snapshot__c','Anchorage_USD_HKD_Rate__c',
            'Anchorage_FX_Settings_Revision__c','Anchorage_Calculation_Version__c',
            'Anchorage_Buyer_Default_USD__c','Anchorage_Buyer_Rate_USD__c','Anchorage_Buyer_Calc_Version__c',
            'Light_Dues_Entry_Date__c','Light_Dues_Category__c','Light_Dues_NRT_Snapshot__c',
            'Light_Dues_Rate_HKD__c','Light_Dues_Amount_HKD__c','Light_Dues_USD_HKD_Rate__c',
            'Light_Dues_FX_Settings_Revision__c','Light_Dues_Calculation_Version__c',
            'Hong_Kong_Bundle_Key__c','Hong_Kong_Bundle_Managed__c','Hong_Kong_Bundle_Sequence__c',
            'Hong_Kong_Bundle_Source__c','Port_Clearance_Rate_HKD__c','Port_Clearance_Calculation_Version__c'
        }, 'WHERE STEM__c = :stemId AND Supplier__c = :supplierId AND Cancelled__c = false ORDER BY Id', binds);
        for (SObject row : extraRows) parts.add('E|' + serializeProjection(row, baseExtraFields));
        addReviewedEvidenceFingerprintParts(parts, stemId, extraRows, true);
        Blob digest = Crypto.generateDigest('SHA-256', Blob.valueOf(String.join(parts, '\n')));
        return EncodingUtil.convertToHex(digest).toLowerCase();
    }

    public static String buyerChargeFingerprint(Id stemId, Id supplierId) {
        List<String> parts = new List<String>();
        Map<String, Object> binds = new Map<String, Object>{'stemId' => stemId, 'supplierId' => supplierId};
        parts.add('S|' + JSON.serialize(fingerprintRows(STEM__c.SObjectType, new List<String>{
            'Id','CreatedDate','Delivery_Date__c','ETA_Start_Date__c','ETA_End_Date__c',
            'ETB_Start_Date__c','ETB_End_Date__c','ETCD_Start_Date__c','ETCD_End_Date__c',
            'ETD_Start_Date__c','ETD_End_Date__c','CurrencyIsoCode'
        }, 'WHERE Id = :stemId LIMIT 1', binds)[0]));
        List<String> lineFields = new List<String>{
            'Id','Original_Supplier__c','Cancelled__c','Product__c','Quantity__c',
            'Quantity_Delivered_Per_BDN__c','Quantity_Max__c','Unit_of_Measure__c',
            'Unit_Sell_At__c','Total_Price__c','CurrencyIsoCode'
        };
        List<SObject> lineRows = fingerprintRows(STEM_Line_Item__c.SObjectType, lineFields,
            'WHERE STEM__c = :stemId AND Cancelled__c = false ORDER BY Id', binds);
        for (SObject row : lineRows) parts.add('P|' + String.valueOf(row.get('Id')));
        for (SObject row : fingerprintRows(Account.SObjectType,
            new List<String>{'Id','Is_Agent__c','Is_Variable__c'}, 'WHERE Id = :supplierId', binds)) {
            parts.add('A|' + JSON.serialize(row));
        }
        for (SObject row : lineRows) if (row.get('Original_Supplier__c') == supplierId)
            parts.add('L|' + serializeProjection(row, lineFields));
        List<String> baseExtraFields = new List<String>{
            'Id','Supplier__c','Cancelled__c','Product2Id__c','Description__c','STEM_Line_Item__c',
            'Quantity__c','Quantity_Delivered_Per_BDN__c','Quantity_Range_Max__c','Unit_of_Measure__c',
            'Unit_Price__c','Lumpsum_Price__c','Line_Total__c','CurrencyIsoCode',
            'Hong_Kong_Bundle_Key__c','Hong_Kong_Bundle_Managed__c','Hong_Kong_Bundle_Sequence__c',
            'Hong_Kong_Bundle_Source__c','Port_Clearance_Rate_HKD__c','Port_Clearance_Calculation_Version__c'
        };
        List<SObject> extraRows = fingerprintRows(STEM_Extra_Cost__c.SObjectType, new List<String>{
            'Id','Supplier__c','Cancelled__c','Product2Id__c','Description__c','STEM_Line_Item__c',
            'Quantity__c','Quantity_Delivered_Per_BDN__c','Quantity_Range_Max__c','Unit_of_Measure__c',
            'Unit_Price__c','Lumpsum_Price__c','Line_Total__c','CurrencyIsoCode',
            'Anchorage_Arrival__c','Anchorage_Departure__c','Anchorage_Location__c',
            'Anchorage_Dues_Allocation_HKD__c','Anchorage_NRT_Snapshot__c','Anchorage_USD_HKD_Rate__c',
            'Anchorage_FX_Settings_Revision__c','Anchorage_Calculation_Version__c',
            'Anchorage_Buyer_Default_USD__c','Anchorage_Buyer_Rate_USD__c','Anchorage_Buyer_Calc_Version__c',
            'Light_Dues_Entry_Date__c','Light_Dues_Category__c','Light_Dues_NRT_Snapshot__c',
            'Light_Dues_Rate_HKD__c','Light_Dues_Amount_HKD__c','Light_Dues_USD_HKD_Rate__c',
            'Light_Dues_FX_Settings_Revision__c','Light_Dues_Calculation_Version__c',
            'Hong_Kong_Bundle_Key__c','Hong_Kong_Bundle_Managed__c','Hong_Kong_Bundle_Sequence__c',
            'Hong_Kong_Bundle_Source__c','Port_Clearance_Rate_HKD__c','Port_Clearance_Calculation_Version__c'
        }, 'WHERE STEM__c = :stemId AND Supplier__c = :supplierId AND Cancelled__c = false ORDER BY Id', binds);
        for (SObject row : extraRows) parts.add('E|' + serializeProjection(row, baseExtraFields));
        addReviewedEvidenceFingerprintParts(parts, stemId, extraRows, false);
        Blob digest = Crypto.generateDigest('SHA-256', Blob.valueOf(String.join(parts, '\n')));
        return EncodingUtil.convertToHex(digest).toLowerCase();
    }

    private static List<SObject> fingerprintRows(
        Schema.SObjectType objectType,
        List<String> requestedFields,
        String whereClause,
        Map<String, Object> binds
    ) {
        Map<String, Schema.SObjectField> available = objectType.getDescribe().fields.getMap();
        List<String> selected = new List<String>();
        for (String field : requestedFields) if (available.containsKey(field)) selected.add(field);
        if (selected.isEmpty() || selected[0] != 'Id') throw messageException('Variable Charges fingerprint schema is unavailable.');
        String soql = 'SELECT ' + String.join(selected, ',') + ' FROM '
            + objectType.getDescribe().getName() + ' ' + whereClause;
        return Database.queryWithBinds(soql, binds, AccessLevel.SYSTEM_MODE);
    }

    private static String serializeProjection(SObject source, List<String> fieldNames) {
        String typeName = source.getSObjectType().getDescribe().getName();
        Map<String, Schema.SObjectField> available = source.getSObjectType().getDescribe().fields.getMap();
        String sourceId = String.valueOf(source.get('Id'));
        String serialized = '{"attributes":{"type":' + JSON.serialize(typeName)
            + ',"url":' + JSON.serialize('/services/data/v67.0/sobjects/' + typeName + '/' + sourceId) + '}';
        for (String fieldName : fieldNames) {
            if (!available.containsKey(fieldName)) continue;
            Object value = source.get(fieldName);
            if (value != null) serialized += ',' + JSON.serialize(fieldName) + ':' + JSON.serialize(value);
        }
        return serialized + '}';
    }

    private static void addReviewedEvidenceFingerprintParts(
        List<String> parts,
        Id stemId,
        List<SObject> extraRows,
        Boolean includeSupplierInput
    ) {
        Boolean hasStatutoryEvidence = false;
        for (SObject row : extraRows) if (row.get('Anchorage_Calculation_Version__c') != null || row.get('Light_Dues_Calculation_Version__c') != null) {
            hasStatutoryEvidence = true;
            break;
        }
        if (hasStatutoryEvidence) {
            List<STEM__c> stems = [SELECT Id, Vessel__r.NRT__c FROM STEM__c WHERE Id = :stemId LIMIT 1];
            parts.add('NRT|' + String.valueOf(stems.isEmpty() ? null : stems[0].Vessel__r?.NRT__c));
        }
        List<String> anchorageFields = new List<String>{
            'Id','Anchorage_Arrival__c','Anchorage_Departure__c','Anchorage_Location__c',
            'Anchorage_Dues_Allocation_HKD__c','Anchorage_NRT_Snapshot__c','Anchorage_USD_HKD_Rate__c',
            'Anchorage_FX_Settings_Revision__c','Anchorage_Calculation_Version__c',
            'Anchorage_Buyer_Default_USD__c','Anchorage_Buyer_Rate_USD__c','Anchorage_Buyer_Calc_Version__c'
        };
        List<String> supplierInputFields = new List<String>{
            'Id','Supplier_Cost_Input_Currency__c','Supplier_Cost_Input_Value__c',
            'Supplier_Cost_USD_HKD_Rate__c','Supplier_Cost_FX_Settings_Revision__c'
        };
        List<String> lightDuesFields = new List<String>{
            'Id','Light_Dues_Entry_Date__c','Light_Dues_Category__c','Light_Dues_NRT_Snapshot__c',
            'Light_Dues_Rate_HKD__c','Light_Dues_Amount_HKD__c','Light_Dues_USD_HKD_Rate__c',
            'Light_Dues_FX_Settings_Revision__c','Light_Dues_Calculation_Version__c'
        };
        for (SObject row : extraRows) {
            if (row.get('Anchorage_Calculation_Version__c') != null) {
                parts.add('H|' + serializeProjection(row, anchorageFields));
            }
        }
        if (includeSupplierInput) for (SObject row : extraRows) {
            if (row.get('Supplier_Cost_USD_HKD_Rate__c') != null) {
                parts.add('C|' + serializeProjection(row, supplierInputFields));
            }
        }
        for (SObject row : extraRows) {
            if (row.get('Light_Dues_Calculation_Version__c') != null) {
                parts.add('D|' + serializeProjection(row, lightDuesFields));
            }
        }
    }

    public static Set<Id> requiredSupplierIds(Id stemId) {
        Set<Id> exact = exactSupplierIds(stemId);
        if (exact.isEmpty()) return new Set<Id>();
        Set<Id> required = new Set<Id>();
        for (Account account : [SELECT Id, Is_Agent__c, Is_Variable__c, Inactive_Suspended__c FROM Account WHERE Id IN :exact]) {
            if (account.Inactive_Suspended__c != true && isVariableChargeAccount(account)) required.add(account.Id);
        }
        for (STEM_Variable_Charge_Supplier__c stage : [
            SELECT Supplier__c, Manual_Review_Required__c
            FROM STEM_Variable_Charge_Supplier__c WHERE STEM__c = :stemId AND Supplier__c IN :exact
        ]) if (stage.Manual_Review_Required__c == true) required.add(stage.Supplier__c);
        return required;
    }

    public static Set<Id> exactSupplierIds(Id stemId) {
        Set<Id> ids = new Set<Id>();
        for (STEM_Line_Item__c row : [SELECT Original_Supplier__c FROM STEM_Line_Item__c WHERE STEM__c = :stemId AND Original_Supplier__c != null AND Cancelled__c = false]) ids.add(row.Original_Supplier__c);
        for (STEM_Extra_Cost__c row : [SELECT Supplier__c FROM STEM_Extra_Cost__c WHERE STEM__c = :stemId AND Supplier__c != null AND Cancelled__c = false]) ids.add(row.Supplier__c);
        return ids;
    }

    public static void invalidateForLineItemChanges(List<STEM_Line_Item__c> newRecords, Map<Id, STEM_Line_Item__c> oldMap) {
        Set<String> costPairs = new Set<String>();
        Set<String> buyerPairs = new Set<String>();
        Set<String> sharedPairs = new Set<String>();
        Map<Id, Integer> activeCountDelta = new Map<Id, Integer>();
        if (newRecords != null) for (STEM_Line_Item__c row : newRecords) {
            STEM_Line_Item__c oldRow = oldMap == null ? null : oldMap.get(row.Id);
            addActiveCountDelta(activeCountDelta, row.STEM__c, row.Cancelled__c != true ? 1 : 0);
            if (oldRow != null) addActiveCountDelta(activeCountDelta, oldRow.STEM__c, oldRow.Cancelled__c != true ? -1 : 0);
            if (oldRow == null || changed(row, oldRow, new List<String>{'STEM__c','Original_Supplier__c','Cancelled__c','Product__c','Quantity__c','Quantity_Delivered_Per_BDN__c','Quantity_Max__c','Unit_of_Measure__c','CurrencyIsoCode'}))
                addChangedPairs(sharedPairs, row, oldRow, 'Original_Supplier__c');
            if (oldRow != null && changed(row, oldRow, new List<String>{'Payment_Term__c','Unit_Buy_At__c','Total_Cost__c','Commission_Cost__c'}))
                addChangedPairs(costPairs, row, oldRow, 'Original_Supplier__c');
            if (oldRow != null && changed(row, oldRow, new List<String>{'Unit_Sell_At__c','Total_Price__c'}))
                addChangedPairs(buyerPairs, row, oldRow, 'Original_Supplier__c');
        }
        if (newRecords == null && oldMap != null) for (STEM_Line_Item__c row : oldMap.values()) {
            addPair(sharedPairs, row.STEM__c, row.Original_Supplier__c);
            addActiveCountDelta(activeCountDelta, row.STEM__c, row.Cancelled__c != true ? -1 : 0);
        }
        costPairs.removeAll(sharedPairs);
        buyerPairs.removeAll(sharedPairs);
        invalidatePairSides(sharedPairs, true, true);
        invalidatePairSides(costPairs, true, false);
        invalidatePairSides(buyerPairs, false, true);
        invalidateProductPresenceTransitions(activeCountDelta);
    }

    public static void invalidateForExtraCostChanges(List<STEM_Extra_Cost__c> newRecords, Map<Id, STEM_Extra_Cost__c> oldMap) {
        Set<String> costPairs = new Set<String>();
        Set<String> buyerPairs = new Set<String>();
        Set<String> sharedPairs = new Set<String>();
        if (newRecords != null) for (STEM_Extra_Cost__c row : newRecords) {
            STEM_Extra_Cost__c oldRow = oldMap == null ? null : oldMap.get(row.Id);
            if (oldRow == null || changed(row, oldRow, new List<String>{'STEM__c','Supplier__c','Cancelled__c','Product2Id__c','Description__c','STEM_Line_Item__c','Quantity__c','Quantity_Delivered_Per_BDN__c','Quantity_Range_Max__c','Unit_of_Measure__c','CurrencyIsoCode','Supplier_Cost_Input_Currency__c','Supplier_Cost_Input_Value__c','Supplier_Cost_USD_HKD_Rate__c','Supplier_Cost_FX_Settings_Revision__c','Anchorage_Arrival__c','Anchorage_Departure__c','Anchorage_Location__c','Anchorage_Dues_Allocation_HKD__c','Anchorage_NRT_Snapshot__c','Anchorage_USD_HKD_Rate__c','Anchorage_FX_Settings_Revision__c','Anchorage_Calculation_Version__c','Anchorage_Buyer_Default_USD__c','Anchorage_Buyer_Rate_USD__c','Anchorage_Buyer_Calc_Version__c','Light_Dues_Entry_Date__c','Light_Dues_Category__c','Light_Dues_NRT_Snapshot__c','Light_Dues_Rate_HKD__c','Light_Dues_Amount_HKD__c','Light_Dues_USD_HKD_Rate__c','Light_Dues_FX_Settings_Revision__c','Light_Dues_Calculation_Version__c','Hong_Kong_Bundle_Key__c','Hong_Kong_Bundle_Managed__c','Hong_Kong_Bundle_Sequence__c','Hong_Kong_Bundle_Source__c','Port_Clearance_Rate_HKD__c','Port_Clearance_Calculation_Version__c'}))
                addChangedPairs(sharedPairs, row, oldRow, 'Supplier__c');
            if (oldRow != null && changed(row, oldRow, new List<String>{'Payment_Term__c','Unit_Cost__c','Lumpsum_Cost__c','Line_Total_Buy__c','Supplier_Invoice__c'}))
                addChangedPairs(costPairs, row, oldRow, 'Supplier__c');
            if (oldRow != null && changed(row, oldRow, new List<String>{'Unit_Price__c','Lumpsum_Price__c','Line_Total__c'}))
                addChangedPairs(buyerPairs, row, oldRow, 'Supplier__c');
        }
        if (newRecords == null && oldMap != null) for (STEM_Extra_Cost__c row : oldMap.values()) addPair(sharedPairs, row.STEM__c, row.Supplier__c);
        costPairs.removeAll(sharedPairs);
        buyerPairs.removeAll(sharedPairs);
        invalidatePairSides(sharedPairs, true, true);
        invalidatePairSides(costPairs, true, false);
        invalidatePairSides(buyerPairs, false, true);
    }

    public static void invalidateForVesselChanges(Map<Id, Vessel__c> newMap, Map<Id, Vessel__c> oldMap) {
        if (newMap == null || oldMap == null) return;
        Set<Id> changedVesselIds = new Set<Id>();
        for (Id vesselId : newMap.keySet()) {
            Vessel__c before = oldMap.get(vesselId), after = newMap.get(vesselId);
            if (before != null && before.NRT__c != after.NRT__c) changedVesselIds.add(vesselId);
        }
        if (changedVesselIds.isEmpty()) return;
        Set<String> pairs = new Set<String>();
        for (STEM_Extra_Cost__c row : [
            SELECT STEM__c, Supplier__c FROM STEM_Extra_Cost__c
            WHERE STEM__r.Vessel__c IN :changedVesselIds AND Cancelled__c = false
                AND Supplier__c != null AND (Anchorage_Calculation_Version__c != null OR Light_Dues_Calculation_Version__c != null)
        ]) addPair(pairs, row.STEM__c, row.Supplier__c);
        invalidatePairSides(pairs, true, true);
    }

    public static void invalidateForAccountChanges(Map<Id, Account> newMap, Map<Id, Account> oldMap) {
        if (newMap == null || oldMap == null) return;
        Set<Id> bothIds = new Set<Id>();
        Set<Id> costIds = new Set<Id>();
        for (Id id : newMap.keySet()) {
            Account before = oldMap.get(id), after = newMap.get(id);
            if (before != null && (before.Is_Agent__c != after.Is_Agent__c
                || before.Is_Variable__c != after.Is_Variable__c
                || before.Inactive_Suspended__c != after.Inactive_Suspended__c)) bothIds.add(id);
            if (before != null && (before.Supplier_Payment_Term__c != after.Supplier_Payment_Term__c
                || before.Agency_Fee_USD__c != after.Agency_Fee_USD__c
                || before.Agency_Fee_Currency__c != after.Agency_Fee_Currency__c)) costIds.add(id);
        }
        Set<Id> ids = new Set<Id>();
        ids.addAll(bothIds);
        ids.addAll(costIds);
        Set<String> bothPairs = new Set<String>();
        Set<String> costPairs = new Set<String>();
        if (!ids.isEmpty()) {
            for (STEM_Line_Item__c row : [SELECT STEM__c, Original_Supplier__c FROM STEM_Line_Item__c WHERE Original_Supplier__c IN :ids AND Cancelled__c = false])
                addPair(bothIds.contains(row.Original_Supplier__c) ? bothPairs : costPairs, row.STEM__c, row.Original_Supplier__c);
            for (STEM_Extra_Cost__c row : [SELECT STEM__c, Supplier__c FROM STEM_Extra_Cost__c WHERE Supplier__c IN :ids AND Cancelled__c = false])
                addPair(bothIds.contains(row.Supplier__c) ? bothPairs : costPairs, row.STEM__c, row.Supplier__c);
        }
        costPairs.removeAll(bothPairs);
        invalidatePairSides(bothPairs, true, true);
        invalidatePairSides(costPairs, true, false);
    }

    public static void invalidateForNominationChanges(List<Nomination__c> newRecords, Map<Id, Nomination__c> oldMap) {
        // Trader nominations only reroute pending FCOS work. They do not change either
        // financial fingerprint and therefore must not invalidate a confirmed side.
    }

    public static void invalidateForSupplierInvoiceChanges(List<Supplier_Invoice__c> newRecords, Map<Id, Supplier_Invoice__c> oldMap) {
        if (newRecords == null || oldMap == null) return;
        Set<String> pairs = new Set<String>();
        for (Supplier_Invoice__c row : newRecords) {
            Supplier_Invoice__c oldRow = oldMap.get(row.Id);
            if (oldRow != null && changed(row, oldRow, new List<String>{'STEM__c','Supplier__c','Invoice_Amount__c','Invoice_Date__c','Invoice_Due_Date__c','Payment_Term__c'})) {
                addPair(pairs, row.STEM__c, row.Supplier__c);
                addPair(pairs, oldRow.STEM__c, oldRow.Supplier__c);
            }
        }
        invalidatePairSides(pairs, true, false);
    }

    public static void invalidateForStemChanges(List<STEM__c> newRecords, Map<Id, STEM__c> oldMap) {
        if (newRecords == null || oldMap == null) return;
        Set<Id> costStems = new Set<Id>();
        Set<Id> buyerStems = new Set<Id>();
        Set<Id> bothStems = new Set<Id>();
        for (STEM__c row : newRecords) {
            STEM__c oldRow = oldMap.get(row.Id);
            if (oldRow == null) continue;
            if (changed(row, oldRow, new List<String>{'Delivery_Date__c','ETA_Start_Date__c','ETA_End_Date__c','ETB_Start_Date__c','ETB_End_Date__c','ETCD_Start_Date__c','ETCD_End_Date__c','ETD_Start_Date__c','ETD_End_Date__c','CurrencyIsoCode'})) bothStems.add(row.Id);
            // Actual row prices/costs invalidate their own side. Posting an
            // invoice or payment only changes rollups and must not revoke review.
            if (changed(row, oldRow, new List<String>{'Payment_Term__c','Account__c'})) buyerStems.add(row.Id);
        }
        Set<Id> buyerAffectedStems = new Set<Id>();
        buyerAffectedStems.addAll(bothStems);
        buyerAffectedStems.addAll(buyerStems);
        for (STEM__c row : newRecords) {
            if (buyerAffectedStems.contains(row.Id)) row.Variable_Charges_Confirmed__c = false;
        }
        costStems.removeAll(bothStems);
        buyerStems.removeAll(bothStems);
        invalidateStagesForStems(bothStems, true, true, false);
        invalidateStagesForStems(costStems, true, false, false);
        invalidateStagesForStems(buyerStems, false, true, false);
    }

    private static SupplierContext loadSupplierContext(Id stemId, Id supplierId) {
        List<STEM__c> stems = [
            SELECT Id, CreatedDate, Delivery_Date__c,
                ETA_Start_Date__c, ETA_End_Date__c, ETB_Start_Date__c, ETB_End_Date__c,
                ETCD_Start_Date__c, ETCD_End_Date__c, ETD_Start_Date__c, ETD_End_Date__c,
                Variable_Charges_Confirmed__c,
                (SELECT Id FROM STEM_Line_Items__r WHERE Cancelled__c = false LIMIT 1)
            FROM STEM__c WHERE Id = :stemId LIMIT 1
        ];
        if (stems.isEmpty()) return null;
        SupplierContext context = new SupplierContext();
        context.stem = stems[0];
        context.hasProductLineItems = !context.stem.STEM_Line_Items__r.isEmpty();
        if (context.stem.CreatedDate.date() < STEM_CREATED_FROM) {
            context.exactSupplier = true; context.required = false; return context;
        }
        List<Account> accounts = [SELECT Id, Name, Is_Agent__c, Is_Variable__c, Inactive_Suspended__c FROM Account WHERE Id = :supplierId LIMIT 1];
        if (!accounts.isEmpty()) context.supplier = accounts[0];
        context.exactSupplier = exactSupplierIds(stemId).contains(supplierId) && context.supplier != null && context.supplier.Inactive_Suspended__c != true;
        String externalKey = pairKey(stemId, supplierId);
        List<STEM_Variable_Charge_Supplier__c> stages = [
            SELECT Id, STEM__c, Supplier__c, Manual_Review_Required__c, Supplier_Status__c,
                Reviewed_Source_Fingerprint__c, Verified_At__c, Verified_By_Email__c, Revision__c,
                Buyer_Charge_Status__c, Buyer_Charge_Reviewed_Source_Fingerprint__c,
                Buyer_Charge_Confirmed_At__c, Buyer_Charge_Confirmed_By_Email__c, Buyer_Charge_Revision__c
            FROM STEM_Variable_Charge_Supplier__c WHERE External_Key__c = :externalKey LIMIT 1
        ];
        context.stage = stages.isEmpty() ? null : stages[0];
        context.required = context.exactSupplier == true
            && (isVariableChargeAccount(context.supplier) || context.stage?.Manual_Review_Required__c == true);
        return context;
    }

    private static Readiness blocked(String reason, Id stemId, Id supplierId, Boolean required) {
        return new Readiness(false, required, reason, stemId, supplierId);
    }

    @TestVisible
    private static Actionability calculateActionability(STEM__c stem, Boolean hasProductLineItems) {
        Actionability result = new Actionability();
        result.hasProductLineItems = hasProductLineItems == true;
        result.deliveryRequired = result.hasProductLineItems;
        if (result.hasProductLineItems) {
            result.actionBasis = 'delivery_date';
            result.actionBasisDate = stem == null ? null : stem.Delivery_Date__c;
        } else {
            Date latestScheduleDate;
            if (stem != null) {
                for (Date candidate : new List<Date>{
                    stem.ETA_Start_Date__c, stem.ETA_End_Date__c,
                    stem.ETB_Start_Date__c, stem.ETB_End_Date__c,
                    stem.ETCD_Start_Date__c, stem.ETCD_End_Date__c,
                    stem.ETD_Start_Date__c, stem.ETD_End_Date__c
                }) if (candidate != null && (latestScheduleDate == null || candidate > latestScheduleDate)) latestScheduleDate = candidate;
            }
            result.actionBasis = latestScheduleDate == null ? 'enquiry_created_date' : 'latest_schedule_date';
            result.actionBasisDate = latestScheduleDate;
            if (result.actionBasisDate == null && stem?.CreatedDate != null) {
                result.actionBasisDate = Date.valueOf(stem.CreatedDate.format('yyyy-MM-dd', 'Asia/Hong_Kong'));
            }
        }
        result.actionableOn = result.actionBasisDate == null ? null : result.actionBasisDate.addDays(1);
        result.ready = result.actionableOn != null && hongKongToday() >= result.actionableOn;
        return result;
    }

    private static Date hongKongToday() {
        return Date.valueOf(System.now().format('yyyy-MM-dd', 'Asia/Hong_Kong'));
    }

    private static String actionabilityReason(Actionability actionability) {
        if (actionability == null || actionability.deliveryRequired == true) {
            return 'Add the Salesforce Delivery Date. The final-charge task becomes available the following day.';
        }
        return actionability.actionableOn == null
            ? 'Add an ETA, ETB, ETCD or ETD schedule date so the final-charge task can be scheduled.'
            : 'The final-charge task is available from ' + String.valueOf(actionability.actionableOn) + '.';
    }

    private static Readiness withActionability(Readiness readiness, Actionability actionability) {
        if (readiness == null || actionability == null) return readiness;
        readiness.deliveryRequired = actionability.deliveryRequired;
        readiness.actionBasis = actionability.actionBasis;
        readiness.actionBasisDate = actionability.actionBasisDate;
        readiness.actionableOn = actionability.actionableOn;
        return readiness;
    }

    private static Readiness blockedForActionability(Actionability actionability, Id stemId, Id supplierId, Boolean required) {
        return withActionability(blocked(actionabilityReason(actionability), stemId, supplierId, required), actionability);
    }

    private static Boolean isFinalBuyerInvoice(Invoice__c invoice) {
        return invoice != null && invoice.Proforma__c != true
            && !(String.isNotBlank(invoice.Name) && invoice.Name.toUpperCase().contains('-CN-'));
    }

    private static AuraHandledException messageException(String message) {
        AuraHandledException error = new AuraHandledException(String.isBlank(message) ? 'Variable Charges are not ready.' : message);
        error.setMessage(String.isBlank(message) ? 'Variable Charges are not ready.' : message);
        return error;
    }

    private static Boolean changed(SObject afterRow, SObject beforeRow, List<String> fields) {
        Map<String, Schema.SObjectField> available = afterRow.getSObjectType().getDescribe().fields.getMap();
        for (String field : fields) {
            if (!available.containsKey(field)) continue;
            try {
                if (String.valueOf(afterRow.get(field)) != String.valueOf(beforeRow.get(field))) return true;
            } catch (SObjectException ignored) {
                // Partial records used by service callers cannot prove a change in an unloaded field.
            }
        }
        return false;
    }

    private static String pairKey(Id stemId, Id supplierId) {
        return String.valueOf(stemId) + ':' + String.valueOf(supplierId);
    }

    private static Id safeId(String value) {
        if (String.isBlank(value)) return null;
        try {
            return Id.valueOf(value.trim());
        } catch (Exception ignored) {
            return null;
        }
    }

    private static void addPair(Set<String> pairs, Id stemId, Id supplierId) {
        if (stemId != null && supplierId != null) pairs.add(pairKey(stemId, supplierId));
    }

    private static void addChangedPairs(Set<String> pairs, SObject afterRow, SObject beforeRow, String supplierField) {
        if (afterRow != null) addPair(pairs, (Id)afterRow.get('STEM__c'), (Id)afterRow.get(supplierField));
        if (beforeRow != null) addPair(pairs, (Id)beforeRow.get('STEM__c'), (Id)beforeRow.get(supplierField));
    }

    private static void addActiveCountDelta(Map<Id, Integer> deltas, Id stemId, Integer delta) {
        if (stemId == null || delta == null || delta == 0) return;
        deltas.put(stemId, (deltas.containsKey(stemId) ? deltas.get(stemId) : 0) + delta);
    }

    private static Set<Id> productBearingStemIds(Set<Id> stemIds) {
        Set<Id> result = new Set<Id>();
        if (stemIds == null || stemIds.isEmpty()) return result;
        for (AggregateResult aggregate : [
            SELECT STEM__c stemId FROM STEM_Line_Item__c
            WHERE STEM__c IN :stemIds AND Cancelled__c = false GROUP BY STEM__c
        ]) result.add((Id)aggregate.get('stemId'));
        return result;
    }

    private static void invalidateProductPresenceTransitions(Map<Id, Integer> activeCountDelta) {
        if (activeCountDelta == null || activeCountDelta.isEmpty()) return;
        Set<Id> stemIds = activeCountDelta.keySet();
        Map<Id, Integer> currentCounts = new Map<Id, Integer>();
        for (AggregateResult aggregate : [
            SELECT STEM__c stemId, COUNT(Id) itemCount FROM STEM_Line_Item__c
            WHERE STEM__c IN :stemIds AND Cancelled__c = false GROUP BY STEM__c
        ]) currentCounts.put((Id)aggregate.get('stemId'), (Integer)aggregate.get('itemCount'));
        Set<Id> transitioned = new Set<Id>();
        for (Id stemId : stemIds) {
            Integer currentCount = currentCounts.containsKey(stemId) ? currentCounts.get(stemId) : 0;
            Integer previousCount = currentCount - activeCountDelta.get(stemId);
            if ((currentCount > 0) != (previousCount > 0)) transitioned.add(stemId);
        }
        invalidateStagesForStems(transitioned, true, true, true);
    }

    private static void invalidateStagesForStems(Set<Id> stemIds, Boolean invalidateCost, Boolean invalidateBuyer, Boolean invalidateStemAggregate) {
        if (invalidationInProgress || stemIds == null || stemIds.isEmpty()) return;
        List<STEM_Variable_Charge_Supplier__c> stages = [
            SELECT Id, STEM__c, Supplier_Status__c, Verified_At__c, Verified_By_Email__c,
                Reviewed_Source_Fingerprint__c, Revision__c, Buyer_Charge_Status__c,
                Buyer_Charge_Reviewed_Source_Fingerprint__c, Buyer_Charge_Confirmed_At__c,
                Buyer_Charge_Confirmed_By_Email__c, Buyer_Charge_Revision__c
            FROM STEM_Variable_Charge_Supplier__c WHERE STEM__c IN :stemIds
        ];
        invalidationInProgress = true;
        try {
            for (STEM_Variable_Charge_Supplier__c stage : stages) {
                invalidateStage(stage, invalidateCost, invalidateBuyer);
            }
            if (!stages.isEmpty()) update stages;
            if (invalidateBuyer == true && invalidateStemAggregate == true) invalidateStems(stemIds);
        } finally {
            invalidationInProgress = false;
        }
    }

    private static void invalidatePairSides(Set<String> pairs, Boolean invalidateCost, Boolean invalidateBuyer) {
        if (invalidationInProgress || pairs == null || pairs.isEmpty()) return;
        Set<Id> stemIds = new Set<Id>();
        List<STEM_Variable_Charge_Supplier__c> stages = [
            SELECT Id, External_Key__c, STEM__c, Supplier_Status__c, Verified_At__c, Verified_By_Email__c,
                Reviewed_Source_Fingerprint__c, Revision__c, Buyer_Charge_Status__c,
                Buyer_Charge_Reviewed_Source_Fingerprint__c, Buyer_Charge_Confirmed_At__c,
                Buyer_Charge_Confirmed_By_Email__c, Buyer_Charge_Revision__c
            FROM STEM_Variable_Charge_Supplier__c WHERE External_Key__c IN :pairs
        ];
        for (String pair : pairs) stemIds.add((Id)pair.substringBefore(':'));
        invalidationInProgress = true;
        try {
            for (STEM_Variable_Charge_Supplier__c stage : stages) {
                invalidateStage(stage, invalidateCost, invalidateBuyer);
            }
            if (!stages.isEmpty()) update stages;
            if (invalidateBuyer == true) invalidateStems(stemIds);
        } finally {
            invalidationInProgress = false;
        }
    }

    private static void invalidateStage(STEM_Variable_Charge_Supplier__c stage, Boolean invalidateCost, Boolean invalidateBuyer) {
        if (invalidateCost == true) {
            if (stage.Supplier_Status__c == 'Verified') stage.Supplier_Status__c = 'Invalidated';
            stage.Verified_At__c = null;
            stage.Verified_By_Email__c = null;
            stage.Reviewed_Source_Fingerprint__c = null;
        }
        if (invalidateBuyer == true) {
            if (stage.Buyer_Charge_Status__c == 'Verified') stage.Buyer_Charge_Status__c = 'Invalidated';
            stage.Buyer_Charge_Confirmed_At__c = null;
            stage.Buyer_Charge_Confirmed_By_Email__c = null;
            stage.Buyer_Charge_Reviewed_Source_Fingerprint__c = null;
        }
    }

    private static void invalidateStems(Set<Id> stemIds) {
        if (stemIds == null || stemIds.isEmpty()) return;
        List<STEM__c> stems = [SELECT Id, Variable_Charges_Confirmed__c FROM STEM__c WHERE Id IN :stemIds AND Variable_Charges_Confirmed__c = true];
        for (STEM__c stem : stems) stem.Variable_Charges_Confirmed__c = false;
        if (!stems.isEmpty()) update stems;
    }
}
