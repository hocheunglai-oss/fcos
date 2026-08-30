public without sharing class MasterContractInvoiceReadinessService {
    public static final String FCOS_URL_PREFIX = 'https://fcos.fcuno.com/master-contracts?contractKey=';

    public class Readiness {
        @AuraEnabled public Boolean ready { get; set; }
        @AuraEnabled public Boolean masterContract { get; set; }
        @AuraEnabled public String reason { get; set; }
        @AuraEnabled public String contractKey { get; set; }
        @AuraEnabled public String fcosUrl { get; set; }
        @AuraEnabled public Integer unresolvedLineCount { get; set; }
    }

    private static Readiness allowed() {
        Readiness result = new Readiness();
        result.ready = true;
        result.masterContract = false;
        result.unresolvedLineCount = 0;
        return result;
    }

    private static Readiness blocked(String reason) {
        Readiness result = new Readiness();
        result.ready = false;
        result.masterContract = false;
        result.reason = reason;
        result.unresolvedLineCount = 0;
        result.fcosUrl = 'https://fcos.fcuno.com/master-contracts';
        return result;
    }

    private static Readiness evaluate(Id stemId, Id supplierId) {
        if (stemId == null) return allowed();
        List<STEM__c> stems = [
            SELECT Id, Master_Contract_Source__c, Master_Contract_Key__c,
                (SELECT Id, Original_Supplier__c, DON_Price_Status__c
                 FROM STEM_Line_Items__r
                 WHERE Master_Contract_Source__c = true AND Cancelled__c = false)
            FROM STEM__c WHERE Id = :stemId LIMIT 1
        ];
        if (stems.isEmpty()) return blocked('The exact STEM identity could not be verified for Master Contract invoice readiness.');
        if (stems[0].Master_Contract_Source__c != true) return allowed();
        STEM__c stem = stems[0];
        Integer unresolved = 0;
        for (STEM_Line_Item__c lineItem : stem.STEM_Line_Items__r) {
            if (supplierId != null && lineItem.Original_Supplier__c != supplierId) continue;
            if (lineItem.DON_Price_Status__c != 'Applied') unresolved++;
        }
        Readiness result = new Readiness();
        result.masterContract = true;
        result.contractKey = stem.Master_Contract_Key__c;
        result.fcosUrl = FCOS_URL_PREFIX + EncodingUtil.urlEncode(stem.Master_Contract_Key__c, 'UTF-8');
        result.unresolvedLineCount = unresolved;
        result.ready = unresolved == 0;
        result.reason = result.ready ? null : 'Apply every reviewed Date of Nomination price for this Master Contract before creating, generating, or sending the invoice.';
        return result;
    }

    @AuraEnabled(cacheable=false)
    public static Readiness getBuyerReadiness(String stemId) {
        Id exactStemId = safeId(stemId);
        return exactStemId == null
            ? blocked('Select an exact STEM before checking Master Contract invoice readiness.')
            : evaluate(exactStemId, null);
    }

    @AuraEnabled(cacheable=false)
    public static Readiness getSupplierReadiness(String stemId, String supplierId) {
        Id exactStemId = safeId(stemId);
        Id exactSupplierId = safeId(supplierId);
        return exactStemId == null || exactSupplierId == null
            ? blocked('Select the exact STEM and Supplier before checking Master Contract invoice readiness.')
            : evaluate(exactStemId, exactSupplierId);
    }

    public static void assertBuyerAllowed(Id stemId) {
        Readiness result = evaluate(stemId, null);
        if (result.ready != true) throw new AuraHandledException(result.reason + ' ' + result.fcosUrl);
    }

    public static void assertSupplierAllowed(Id stemId, Id supplierId) {
        Readiness result = evaluate(stemId, supplierId);
        if (result.ready != true) throw new AuraHandledException(result.reason + ' ' + result.fcosUrl);
    }

    public static void assertInvoiceRecordsAllowed(List<Invoice__c> invoices) {
        if (invoices == null) return;
        for (Invoice__c invoice : invoices) {
            Readiness result = evaluate(invoice.STEM__c, null);
            if (result.ready != true) invoice.addError(result.reason + ' ' + result.fcosUrl);
        }
    }

    public static void assertInvoiceTransitionsAllowed(Map<Id, Invoice__c> newMap, Map<Id, Invoice__c> oldMap) {
        if (newMap == null) return;
        for (Invoice__c invoice : newMap.values()) {
            Invoice__c oldInvoice = oldMap == null ? null : oldMap.get(invoice.Id);
            Boolean consequential = oldInvoice == null
                || invoice.STEM__c != oldInvoice.STEM__c
                || (oldInvoice.File__c == null && invoice.File__c != null)
                || (oldInvoice.Sent__c != true && invoice.Sent__c == true);
            if (!consequential) continue;
            Readiness result = evaluate(invoice.STEM__c, null);
            if (result.ready != true) invoice.addError(result.reason + ' ' + result.fcosUrl);
        }
    }

    public static void assertPersistedInvoicesAllowed(Set<Id> invoiceIds) {
        if (invoiceIds == null || invoiceIds.isEmpty()) return;
        List<Invoice__c> invoices = [SELECT Id, STEM__c FROM Invoice__c WHERE Id IN :invoiceIds];
        if (invoices.size() != invoiceIds.size()) throw new AuraHandledException('Master Contract invoice readiness could not be verified.');
        for (Invoice__c invoice : invoices) assertBuyerAllowed(invoice.STEM__c);
    }

    public static void assertSupplierInvoiceTransitionsAllowed(List<Supplier_Invoice__c> invoices, Map<Id, Supplier_Invoice__c> oldMap) {
        if (invoices == null) return;
        for (Supplier_Invoice__c invoice : invoices) {
            Supplier_Invoice__c oldInvoice = oldMap == null ? null : oldMap.get(invoice.Id);
            Boolean consequential = oldInvoice == null || invoice.STEM__c != oldInvoice.STEM__c || invoice.Supplier__c != oldInvoice.Supplier__c;
            if (!consequential) continue;
            Readiness result = evaluate(invoice.STEM__c, invoice.Supplier__c);
            if (result.ready != true) invoice.addError(result.reason + ' ' + result.fcosUrl);
        }
    }

    private static Id safeId(String value) {
        if (String.isBlank(value)) return null;
        try { return Id.valueOf(value); } catch (Exception ignored) { return null; }
    }
}
