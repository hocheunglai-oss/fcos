public without sharing class ShipAgentInvoiceReadinessService {
    public static final String FCOS_URL_PREFIX = 'https://fcos.fcuno.com/payment-collections?tab=ship-agent-charges&stemId=';
    private static Boolean invalidationInProgress = false;

    public class Readiness {
        @AuraEnabled public Boolean ready { get; set; }
        @AuraEnabled public Boolean requiresShipAgentReview { get; set; }
        @AuraEnabled public String reason { get; set; }
        @AuraEnabled public String fcosUrl { get; set; }

        public Readiness(Boolean ready, Boolean requiresShipAgentReview, String reason, Id stemId) {
            this.ready = ready;
            this.requiresShipAgentReview = requiresShipAgentReview;
            this.reason = reason;
            this.fcosUrl = stemId == null ? null : FCOS_URL_PREFIX + String.valueOf(stemId);
        }
    }

    @AuraEnabled(cacheable=false)
    public static Readiness getReadiness(String stemId) {
        if (String.isBlank(stemId)) return new Readiness(false, true, 'A STEM is required to verify ship-agent charges.', null);
        try {
            return evaluate(Id.valueOf(stemId));
        } catch (Exception ex) {
            return new Readiness(false, true, 'Ship-agent charge readiness could not be verified. Refresh and try again.', null);
        }
    }

    public static Readiness evaluate(Id stemId) {
        if (stemId == null) return new Readiness(false, true, 'A STEM is required to verify ship-agent charges.', null);
        try {
            List<STEM__c> stems = [
                SELECT Id, Delivery_Date__c, Ship_Agent_Charges_Confirmed__c,
                    (SELECT Original_Supplier__c, Original_Supplier__r.Imported_Particulars__c
                     FROM STEM_Line_Items__r
                     WHERE Cancelled__c = false AND Original_Supplier__c != null),
                    (SELECT Supplier__c, Supplier__r.Imported_Particulars__c
                     FROM STEM_Extra_Costs__r
                     WHERE Cancelled__c = false AND Supplier__c != null)
                FROM STEM__c WHERE Id = :stemId LIMIT 1
            ];
            if (stems.isEmpty()) return new Readiness(false, true, 'The STEM could not be found for ship-agent charge verification.', stemId);

            STEM__c stem = stems[0];
            Set<Id> supplierIds = new Set<Id>();
            Map<Id, String> particularsBySupplierId = new Map<Id, String>();
            for (STEM_Line_Item__c lineItem : stem.STEM_Line_Items__r) {
                supplierIds.add(lineItem.Original_Supplier__c);
                particularsBySupplierId.put(lineItem.Original_Supplier__c, lineItem.Original_Supplier__r.Imported_Particulars__c);
            }
            for (STEM_Extra_Cost__c extraCost : stem.STEM_Extra_Costs__r) {
                supplierIds.add(extraCost.Supplier__c);
                particularsBySupplierId.put(extraCost.Supplier__c, extraCost.Supplier__r.Imported_Particulars__c);
            }

            Boolean hasShipAgent = false;
            for (Id supplierId : supplierIds) {
                String particulars = particularsBySupplierId.get(supplierId);
                if (String.isNotBlank(particulars) && particulars.toLowerCase().contains('ship agent')) {
                    hasShipAgent = true;
                    break;
                }
            }
            if (!hasShipAgent) return new Readiness(true, false, null, stemId);

            if (stem.Delivery_Date__c == null) {
                return new Readiness(false, true, 'Ship-agent charges can be confirmed only after the STEM delivery date is recorded.', stemId);
            }
            if (stem.Delivery_Date__c >= Date.today()) {
                return new Readiness(false, true, 'Ship-agent charges become actionable only after the STEM delivery date.', stemId);
            }
            if (stem.Ship_Agent_Charges_Confirmed__c != true) {
                return new Readiness(false, true, 'Ship-agent charges require FCOS review and confirmation before a final buyer invoice can be generated or sent.', stemId);
            }
            return new Readiness(true, true, null, stemId);
        } catch (Exception ex) {
            return new Readiness(false, true, 'Ship-agent charge readiness could not be verified. Refresh and try again.', stemId);
        }
    }

    public static void assertFinalBuyerInvoiceAllowed(Id stemId) {
        Readiness readiness = evaluate(stemId);
        if (readiness.ready != true) {
            throw new AuraHandledException(String.isBlank(readiness.reason)
                ? 'Final buyer invoice processing is blocked until ship-agent charges are ready.'
                : readiness.reason);
        }
    }

    public static void assertPersistedInvoicesAllowed(Set<Id> invoiceIds) {
        if (invoiceIds == null || invoiceIds.isEmpty()) return;
        List<Invoice__c> invoices = [SELECT Id, Name, STEM__c, Proforma__c FROM Invoice__c WHERE Id IN :invoiceIds];
        if (invoices.size() != invoiceIds.size()) {
            throw new AuraHandledException('Final buyer invoice processing is blocked because invoice readiness could not be verified.');
        }
        assertInvoiceRecordsAllowed(invoices);
    }

    public static void assertInvoiceRecordsAllowed(List<Invoice__c> invoices) {
        if (invoices == null) return;
        for (Invoice__c invoice : invoices) {
            if (isFinalBuyerInvoice(invoice)) assertFinalBuyerInvoiceAllowed(invoice.STEM__c);
        }
    }

    public static void assertInvoiceTransitionsAllowed(Map<Id, Invoice__c> newMap, Map<Id, Invoice__c> oldMap) {
        if (newMap == null) return;
        List<Invoice__c> invoicesToCheck = new List<Invoice__c>();
        for (Invoice__c invoice : newMap.values()) {
            if (!isFinalBuyerInvoice(invoice)) continue;
            Invoice__c oldInvoice = oldMap == null ? null : oldMap.get(invoice.Id);
            Boolean isNew = oldInvoice == null;
            Boolean isGenerating = !isNew && oldInvoice.File__c == null && invoice.File__c != null;
            Boolean isSending = !isNew && oldInvoice.Sent__c != true && invoice.Sent__c == true;
            if (isNew || isGenerating || isSending) invoicesToCheck.add(invoice);
        }
        assertInvoiceRecordsAllowed(invoicesToCheck);
    }

    public static Boolean isFinalBuyerInvoice(Invoice__c invoice) {
        return invoice != null && invoice.Proforma__c != true
            && !(String.isNotBlank(invoice.Name) && invoice.Name.toUpperCase().contains('-CN-'));
    }

    public static void invalidateForStemChanges(List<STEM__c> newRecords, Map<Id, STEM__c> oldMap) {
        if (newRecords == null || oldMap == null) return;
        Set<Id> stemIds = new Set<Id>();
        List<String> fields = new List<String>{'Delivery_Date__c', 'Payment_Term__c', 'Account__c', 'Total__c', 'Costs_Total__c', 'Total_Invoice_Amount__c', 'Receivable_Balance__c', 'Payable_Balance__c', 'CurrencyIsoCode'};
        for (STEM__c record : newRecords) {
            if (oldMap.containsKey(record.Id) && hasChanged(record, oldMap.get(record.Id), fields)) stemIds.add(record.Id);
        }
        invalidateForStems(stemIds);
    }

    public static void invalidateForLineItemChanges(List<STEM_Line_Item__c> newRecords, Map<Id, STEM_Line_Item__c> oldMap) {
        Set<Id> stemIds = new Set<Id>();
        List<String> fields = new List<String>{'STEM__c', 'Original_Supplier__c', 'Cancelled__c', 'Product__c', 'Payment_Term__c', 'Quantity__c', 'Quantity_Delivered_Per_BDN__c', 'Quantity_Max__c', 'Unit_of_Measure__c', 'Price_Per_Unit__c', 'Cost_Per_Unit__c', 'Unit_Sell_At__c', 'Unit_Buy_At__c', 'Total_Price__c', 'Total_Cost__c', 'Commission_Cost__c', 'CurrencyIsoCode'};
        if (newRecords != null) for (STEM_Line_Item__c record : newRecords) {
            STEM_Line_Item__c oldRecord = oldMap == null ? null : oldMap.get(record.Id);
            if (oldRecord == null || hasChanged(record, oldRecord, fields)) {
                if (record.STEM__c != null) stemIds.add(record.STEM__c);
                if (oldRecord != null && oldRecord.STEM__c != null) stemIds.add(oldRecord.STEM__c);
            }
        }
        if (newRecords == null && oldMap != null) for (STEM_Line_Item__c oldRecord : oldMap.values()) if (oldRecord.STEM__c != null) stemIds.add(oldRecord.STEM__c);
        invalidateForStems(stemIds);
    }

    public static void invalidateForExtraCostChanges(List<STEM_Extra_Cost__c> newRecords, Map<Id, STEM_Extra_Cost__c> oldMap) {
        Set<Id> stemIds = new Set<Id>();
        List<String> fields = new List<String>{'STEM__c', 'Supplier__c', 'Cancelled__c', 'Product2Id__c', 'Description__c', 'Payment_Term__c', 'STEM_Line_Item__c', 'Quantity__c', 'Quantity_Delivered_Per_BDN__c', 'Quantity_Range_Max__c', 'Unit_of_Measure__c', 'Unit_Price__c', 'Unit_Cost__c', 'Lumpsum_Price__c', 'Lumpsum_Cost__c', 'Line_Total__c', 'Line_Total_Buy__c', 'Supplier_Invoice__c', 'CurrencyIsoCode'};
        if (newRecords != null) for (STEM_Extra_Cost__c record : newRecords) {
            STEM_Extra_Cost__c oldRecord = oldMap == null ? null : oldMap.get(record.Id);
            if (oldRecord == null || hasChanged(record, oldRecord, fields)) {
                if (record.STEM__c != null) stemIds.add(record.STEM__c);
                if (oldRecord != null && oldRecord.STEM__c != null) stemIds.add(oldRecord.STEM__c);
            }
        }
        if (newRecords == null && oldMap != null) for (STEM_Extra_Cost__c oldRecord : oldMap.values()) if (oldRecord.STEM__c != null) stemIds.add(oldRecord.STEM__c);
        invalidateForStems(stemIds);
    }

    public static void invalidateForAccountChanges(Map<Id, Account> newMap, Map<Id, Account> oldMap) {
        if (newMap == null || oldMap == null) return;
        Set<Id> accountIds = new Set<Id>();
        for (Id accountId : newMap.keySet()) {
            Account oldAccount = oldMap.get(accountId);
            if (oldAccount != null && (
                String.valueOf(newMap.get(accountId).Imported_Particulars__c) != String.valueOf(oldAccount.Imported_Particulars__c)
                || String.valueOf(newMap.get(accountId).Supplier_Payment_Term__c) != String.valueOf(oldAccount.Supplier_Payment_Term__c)
            )) accountIds.add(accountId);
        }
        if (accountIds.isEmpty()) return;
        Set<Id> stemIds = new Set<Id>();
        for (STEM_Line_Item__c row : [SELECT STEM__c FROM STEM_Line_Item__c WHERE Original_Supplier__c IN :accountIds AND Cancelled__c = false]) stemIds.add(row.STEM__c);
        for (STEM_Extra_Cost__c row : [SELECT STEM__c FROM STEM_Extra_Cost__c WHERE Supplier__c IN :accountIds AND Cancelled__c = false]) stemIds.add(row.STEM__c);
        invalidateForStems(stemIds);
    }

    public static void invalidateForNominationChanges(List<Nomination__c> newRecords, Map<Id, Nomination__c> oldMap) {
        Set<Id> stemIds = new Set<Id>();
        List<String> fields = new List<String>{'STEM__c', 'Buyer_Supplier_Trader__c', 'Deprecated__c', 'Buyer_Confirmation__c', 'RecordTypeId'};
        if (newRecords != null) for (Nomination__c record : newRecords) {
            Nomination__c oldRecord = oldMap == null ? null : oldMap.get(record.Id);
            if (oldRecord == null || hasChanged(record, oldRecord, fields)) {
                if (record.STEM__c != null) stemIds.add(record.STEM__c);
                if (oldRecord != null && oldRecord.STEM__c != null) stemIds.add(oldRecord.STEM__c);
            }
        }
        if (newRecords == null && oldMap != null) for (Nomination__c oldRecord : oldMap.values()) if (oldRecord.STEM__c != null) stemIds.add(oldRecord.STEM__c);
        invalidateForStems(stemIds);
    }

    private static Boolean hasChanged(SObject record, SObject oldRecord, List<String> fields) {
        Map<String, Schema.SObjectField> availableFields = record.getSObjectType().getDescribe().fields.getMap();
        for (String fieldName : fields) {
            if (!availableFields.containsKey(fieldName)) continue;
            if (String.valueOf(record.get(fieldName)) != String.valueOf(oldRecord.get(fieldName))) return true;
        }
        return false;
    }

    private static void invalidateForStems(Set<Id> stemIds) {
        if (invalidationInProgress || stemIds == null || stemIds.isEmpty()) return;
        List<STEM__c> stems = [SELECT Id, Ship_Agent_Charges_Confirmed__c FROM STEM__c WHERE Id IN :stemIds AND Ship_Agent_Charges_Confirmed__c = true];
        if (stems.isEmpty()) return;
        invalidationInProgress = true;
        try {
            for (STEM__c stem : stems) stem.Ship_Agent_Charges_Confirmed__c = false;
            update stems;
        } finally {
            invalidationInProgress = false;
        }
    }
}
