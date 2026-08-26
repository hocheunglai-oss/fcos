public without sharing class VariableChargeInvoiceReadinessService {
    public static final String FCOS_URL_PREFIX = 'https://fcos.fcuno.com/payment-collections?tab=variable-charges&stemId=';
    public static final Date STEM_CREATED_FROM = Date.newInstance(2026, 1, 1);
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
                    Original_Supplier__r.Inactive_Suspended__c
                 FROM STEM_Line_Items__r
                 WHERE Cancelled__c = false),
                (SELECT Supplier__c, Supplier__r.Is_Agent__c,
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
            if (lineItem.Original_Supplier__r?.Is_Agent__c == true) requiredIds.add(lineItem.Original_Supplier__c);
        }
        for (STEM_Extra_Cost__c extraCost : stem.STEM_Extra_Costs__r) {
            if (extraCost.Supplier__r?.Inactive_Suspended__c == true) continue;
            exactIds.add(extraCost.Supplier__c);
            if (extraCost.Supplier__r?.Is_Agent__c == true) requiredIds.add(extraCost.Supplier__c);
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
            Readiness supplierReadiness = evaluateSupplier(stemId, supplierId);
            if (supplierReadiness.ready != true) return supplierReadiness;
        }
        if (stem.Variable_Charges_Confirmed__c != true) {
            return blocked('Approve buyer charges in FCOS before creating the final Buyer Invoice.', stemId, null, true);
        }
        return withActionability(new Readiness(true, true, null, stemId, null), actionability);
    }

    public static void assertFinalBuyerInvoiceAllowed(Id stemId) {
        Readiness readiness = evaluateBuyer(stemId);
        if (readiness.ready != true) throw messageException(readiness.reason);
    }

    public static void assertPersistedInvoicesAllowed(Set<Id> invoiceIds) {
        if (invoiceIds == null || invoiceIds.isEmpty()) return;
        List<Invoice__c> invoices = [SELECT Id, Name, STEM__c, Proforma__c FROM Invoice__c WHERE Id IN :invoiceIds];
        if (invoices.size() != invoiceIds.size()) throw messageException('Final buyer invoice readiness could not be verified.');
        assertInvoiceRecordsAllowed(invoices);
    }

    public static void assertInvoiceRecordsAllowed(List<Invoice__c> invoices) {
        if (invoices == null) return;
        for (Invoice__c invoice : invoices) if (isFinalBuyerInvoice(invoice)) assertFinalBuyerInvoiceAllowed(invoice.STEM__c);
    }

    public static void assertInvoiceTransitionsAllowed(Map<Id, Invoice__c> newMap, Map<Id, Invoice__c> oldMap) {
        if (newMap == null) return;
        List<Invoice__c> check = new List<Invoice__c>();
        for (Invoice__c invoice : newMap.values()) {
            if (!isFinalBuyerInvoice(invoice)) continue;
            Invoice__c oldInvoice = oldMap == null ? null : oldMap.get(invoice.Id);
            if (oldInvoice == null
                || (oldInvoice.File__c == null && invoice.File__c != null)
                || (oldInvoice.Sent__c != true && invoice.Sent__c == true)) check.add(invoice);
        }
        assertInvoiceRecordsAllowed(check);
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
                Readiness readiness = evaluateSupplier(stem.Id, supplierId);
                if (readiness.ready != true) {
                    stem.addError(readiness.reason);
                    break;
                }
            }
        }
    }

    public static String supplierFingerprint(Id stemId, Id supplierId) {
        List<String> parts = new List<String>();
        STEM__c readinessStem = [
            SELECT Id, CreatedDate, Delivery_Date__c,
                ETA_Start_Date__c, ETA_End_Date__c, ETB_Start_Date__c, ETB_End_Date__c,
                ETCD_Start_Date__c, ETCD_End_Date__c, ETD_Start_Date__c, ETD_End_Date__c
            FROM STEM__c WHERE Id = :stemId LIMIT 1
        ];
        parts.add('S|' + JSON.serialize(readinessStem));
        for (STEM_Line_Item__c row : [
            SELECT Id FROM STEM_Line_Item__c
            WHERE STEM__c = :stemId AND Cancelled__c = false ORDER BY Id
        ]) parts.add('P|' + row.Id);
        for (Account row : [SELECT Id, Is_Agent__c, Supplier_Payment_Term__c, LastModifiedDate FROM Account WHERE Id = :supplierId]) {
            parts.add('A|' + row.Id + '|' + row.Is_Agent__c + '|' + row.Supplier_Payment_Term__c + '|' + row.LastModifiedDate.getTime());
        }
        for (STEM_Line_Item__c row : [
            SELECT Id, Original_Supplier__c, Cancelled__c, Product__c, Payment_Term__c, Quantity__c,
                Quantity_Delivered_Per_BDN__c, Quantity_Max__c, Unit_of_Measure__c,
                Unit_Sell_At__c, Unit_Buy_At__c, Total_Price__c, Total_Cost__c,
                Commission_Cost__c, LastModifiedDate
            FROM STEM_Line_Item__c
            WHERE STEM__c = :stemId AND Original_Supplier__c = :supplierId AND Cancelled__c = false ORDER BY Id
        ]) parts.add('L|' + JSON.serialize(row));
        for (STEM_Extra_Cost__c row : [
            SELECT Id, Supplier__c, Cancelled__c, Product2Id__c, Description__c, Payment_Term__c,
                STEM_Line_Item__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_Range_Max__c,
                Unit_of_Measure__c, Unit_Price__c, Unit_Cost__c, Lumpsum_Price__c, Lumpsum_Cost__c,
                Line_Total__c, Line_Total_Buy__c, Supplier_Invoice__c, LastModifiedDate
            FROM STEM_Extra_Cost__c
            WHERE STEM__c = :stemId AND Supplier__c = :supplierId AND Cancelled__c = false ORDER BY Id
        ]) parts.add('E|' + JSON.serialize(row));
        for (Nomination__c row : [
            SELECT Id, Buyer_Supplier_Trader__c, BT_ST_Email_Address__c, Deprecated__c, LastModifiedDate
            FROM Nomination__c
            WHERE STEM__c = :stemId AND Account__c = :supplierId AND Deprecated__c = false
                AND RecordTypeId = :FCBStatic.SUPPLIER_NOMINATION_RT_ID ORDER BY Id
        ]) parts.add('N|' + JSON.serialize(row));
        Blob digest = Crypto.generateDigest('SHA-256', Blob.valueOf(String.join(parts, '\n')));
        return EncodingUtil.convertToHex(digest).toLowerCase();
    }

    public static Set<Id> requiredSupplierIds(Id stemId) {
        Set<Id> exact = exactSupplierIds(stemId);
        if (exact.isEmpty()) return new Set<Id>();
        Set<Id> required = new Set<Id>();
        for (Account account : [SELECT Id, Is_Agent__c, Inactive_Suspended__c FROM Account WHERE Id IN :exact]) {
            if (account.Inactive_Suspended__c != true && account.Is_Agent__c == true) required.add(account.Id);
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
        Set<String> pairs = new Set<String>();
        Map<Id, Integer> activeCountDelta = new Map<Id, Integer>();
        if (newRecords != null) for (STEM_Line_Item__c row : newRecords) {
            STEM_Line_Item__c oldRow = oldMap == null ? null : oldMap.get(row.Id);
            addActiveCountDelta(activeCountDelta, row.STEM__c, row.Cancelled__c != true ? 1 : 0);
            if (oldRow != null) addActiveCountDelta(activeCountDelta, oldRow.STEM__c, oldRow.Cancelled__c != true ? -1 : 0);
            if (oldRow == null || changed(row, oldRow, new List<String>{'STEM__c','Original_Supplier__c','Cancelled__c','Product__c','Payment_Term__c','Quantity__c','Quantity_Delivered_Per_BDN__c','Quantity_Max__c','Unit_of_Measure__c','Unit_Sell_At__c','Unit_Buy_At__c','Total_Price__c','Total_Cost__c','Commission_Cost__c','CurrencyIsoCode'})) {
                addPair(pairs, row.STEM__c, row.Original_Supplier__c);
                if (oldRow != null) addPair(pairs, oldRow.STEM__c, oldRow.Original_Supplier__c);
            }
        }
        if (newRecords == null && oldMap != null) for (STEM_Line_Item__c row : oldMap.values()) {
            addPair(pairs, row.STEM__c, row.Original_Supplier__c);
            addActiveCountDelta(activeCountDelta, row.STEM__c, row.Cancelled__c != true ? -1 : 0);
        }
        invalidatePairs(pairs);
        invalidateProductPresenceTransitions(activeCountDelta);
    }

    public static void invalidateForExtraCostChanges(List<STEM_Extra_Cost__c> newRecords, Map<Id, STEM_Extra_Cost__c> oldMap) {
        Set<String> pairs = new Set<String>();
        if (newRecords != null) for (STEM_Extra_Cost__c row : newRecords) {
            STEM_Extra_Cost__c oldRow = oldMap == null ? null : oldMap.get(row.Id);
            if (oldRow == null || changed(row, oldRow, new List<String>{'STEM__c','Supplier__c','Cancelled__c','Product2Id__c','Description__c','Payment_Term__c','STEM_Line_Item__c','Quantity__c','Quantity_Delivered_Per_BDN__c','Quantity_Range_Max__c','Unit_of_Measure__c','Unit_Price__c','Unit_Cost__c','Lumpsum_Price__c','Lumpsum_Cost__c','Line_Total__c','Line_Total_Buy__c','Supplier_Invoice__c','CurrencyIsoCode'})) {
                addPair(pairs, row.STEM__c, row.Supplier__c);
                if (oldRow != null) addPair(pairs, oldRow.STEM__c, oldRow.Supplier__c);
            }
        }
        if (newRecords == null && oldMap != null) for (STEM_Extra_Cost__c row : oldMap.values()) addPair(pairs, row.STEM__c, row.Supplier__c);
        invalidatePairs(pairs);
    }

    public static void invalidateForAccountChanges(Map<Id, Account> newMap, Map<Id, Account> oldMap) {
        if (newMap == null || oldMap == null) return;
        Set<Id> ids = new Set<Id>();
        for (Id id : newMap.keySet()) {
            Account before = oldMap.get(id), after = newMap.get(id);
            if (before != null && (before.Is_Agent__c != after.Is_Agent__c || before.Supplier_Payment_Term__c != after.Supplier_Payment_Term__c)) ids.add(id);
        }
        Set<String> pairs = new Set<String>();
        if (!ids.isEmpty()) {
            for (STEM_Line_Item__c row : [SELECT STEM__c, Original_Supplier__c FROM STEM_Line_Item__c WHERE Original_Supplier__c IN :ids AND Cancelled__c = false]) addPair(pairs, row.STEM__c, row.Original_Supplier__c);
            for (STEM_Extra_Cost__c row : [SELECT STEM__c, Supplier__c FROM STEM_Extra_Cost__c WHERE Supplier__c IN :ids AND Cancelled__c = false]) addPair(pairs, row.STEM__c, row.Supplier__c);
        }
        invalidatePairs(pairs);
    }

    public static void invalidateForNominationChanges(List<Nomination__c> newRecords, Map<Id, Nomination__c> oldMap) {
        Set<String> pairs = new Set<String>();
        if (newRecords != null) for (Nomination__c row : newRecords) {
            Nomination__c oldRow = oldMap == null ? null : oldMap.get(row.Id);
            if (oldRow == null || changed(row, oldRow, new List<String>{'STEM__c','Account__c','Buyer_Supplier_Trader__c','Deprecated__c','RecordTypeId'})) {
                addPair(pairs, row.STEM__c, row.Account__c);
                if (oldRow != null) addPair(pairs, oldRow.STEM__c, oldRow.Account__c);
            }
        }
        if (newRecords == null && oldMap != null) for (Nomination__c row : oldMap.values()) addPair(pairs, row.STEM__c, row.Account__c);
        invalidatePairs(pairs);
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
        invalidatePairs(pairs);
    }

    public static void invalidateForStemChanges(List<STEM__c> newRecords, Map<Id, STEM__c> oldMap) {
        if (newRecords == null || oldMap == null) return;
        Set<Id> stems = new Set<Id>();
        Set<Id> readinessStems = new Set<Id>();
        for (STEM__c row : newRecords) {
            STEM__c oldRow = oldMap.get(row.Id);
            if (oldRow != null && changed(row, oldRow, new List<String>{'Delivery_Date__c','Payment_Term__c','Account__c','Total__c','Costs_Total__c','Total_Invoice_Amount__c','Receivable_Balance__c','Payable_Balance__c','CurrencyIsoCode'})) stems.add(row.Id);
            if (oldRow != null && changed(row, oldRow, new List<String>{'Delivery_Date__c','ETA_Start_Date__c','ETA_End_Date__c','ETB_Start_Date__c','ETB_End_Date__c','ETCD_Start_Date__c','ETCD_End_Date__c','ETD_Start_Date__c','ETD_End_Date__c'})) readinessStems.add(row.Id);
        }
        stems.addAll(readinessStems);
        invalidateAllStages(readinessStems);
        invalidateStems(stems);
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
        List<Account> accounts = [SELECT Id, Name, Is_Agent__c, Inactive_Suspended__c FROM Account WHERE Id = :supplierId LIMIT 1];
        if (!accounts.isEmpty()) context.supplier = accounts[0];
        context.exactSupplier = exactSupplierIds(stemId).contains(supplierId) && context.supplier != null && context.supplier.Inactive_Suspended__c != true;
        String externalKey = pairKey(stemId, supplierId);
        List<STEM_Variable_Charge_Supplier__c> stages = [
            SELECT Id, STEM__c, Supplier__c, Manual_Review_Required__c, Supplier_Status__c,
                Reviewed_Source_Fingerprint__c, Verified_At__c, Verified_By_Email__c, Revision__c
            FROM STEM_Variable_Charge_Supplier__c WHERE External_Key__c = :externalKey LIMIT 1
        ];
        context.stage = stages.isEmpty() ? null : stages[0];
        context.required = context.exactSupplier == true
            && (context.supplier.Is_Agent__c == true || context.stage?.Manual_Review_Required__c == true);
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
        invalidateAllStages(transitioned);
    }

    private static void invalidateAllStages(Set<Id> stemIds) {
        if (invalidationInProgress || stemIds == null || stemIds.isEmpty()) return;
        List<STEM_Variable_Charge_Supplier__c> stages = [
            SELECT Id, STEM__c, Supplier_Status__c, Verified_At__c, Verified_By_Email__c,
                Reviewed_Source_Fingerprint__c, Revision__c
            FROM STEM_Variable_Charge_Supplier__c WHERE STEM__c IN :stemIds
        ];
        invalidationInProgress = true;
        try {
            for (STEM_Variable_Charge_Supplier__c stage : stages) {
                if (stage.Supplier_Status__c == 'Verified') stage.Supplier_Status__c = 'Invalidated';
                stage.Verified_At__c = null;
                stage.Verified_By_Email__c = null;
                stage.Reviewed_Source_Fingerprint__c = null;
            }
            if (!stages.isEmpty()) update stages;
            invalidateStems(stemIds);
        } finally {
            invalidationInProgress = false;
        }
    }

    private static void invalidatePairs(Set<String> pairs) {
        if (invalidationInProgress || pairs == null || pairs.isEmpty()) return;
        Set<Id> stemIds = new Set<Id>();
        List<STEM_Variable_Charge_Supplier__c> stages = [
            SELECT Id, External_Key__c, STEM__c, Supplier_Status__c, Verified_At__c, Verified_By_Email__c,
                Reviewed_Source_Fingerprint__c, Revision__c
            FROM STEM_Variable_Charge_Supplier__c WHERE External_Key__c IN :pairs
        ];
        for (String pair : pairs) stemIds.add((Id)pair.substringBefore(':'));
        invalidationInProgress = true;
        try {
            for (STEM_Variable_Charge_Supplier__c stage : stages) {
                if (stage.Supplier_Status__c == 'Verified') stage.Supplier_Status__c = 'Invalidated';
                stage.Verified_At__c = null;
                stage.Verified_By_Email__c = null;
                stage.Reviewed_Source_Fingerprint__c = null;
            }
            if (!stages.isEmpty()) update stages;
            invalidateStems(stemIds);
        } finally {
            invalidationInProgress = false;
        }
    }

    private static void invalidateStems(Set<Id> stemIds) {
        if (stemIds == null || stemIds.isEmpty()) return;
        List<STEM__c> stems = [SELECT Id, Variable_Charges_Confirmed__c FROM STEM__c WHERE Id IN :stemIds AND Variable_Charges_Confirmed__c = true];
        for (STEM__c stem : stems) stem.Variable_Charges_Confirmed__c = false;
        if (!stems.isEmpty()) update stems;
    }
}
