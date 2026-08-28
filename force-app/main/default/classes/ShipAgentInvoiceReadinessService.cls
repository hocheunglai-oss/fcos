/**
 * Temporary rollback-compatible facade for the former Ship-Agent API.
 *
 * The canonical readiness authority is VariableChargeInvoiceReadinessService.
 * Keep this facade only through the monitored legacy-traffic window so older
 * Salesforce callers cannot drift back to Imported Particulars detection.
 */
public without sharing class ShipAgentInvoiceReadinessService {
    public static final String FCOS_URL_PREFIX = VariableChargeInvoiceReadinessService.FCOS_URL_PREFIX;

    public class Readiness {
        @AuraEnabled public Boolean ready { get; set; }
        @AuraEnabled public Boolean requiresShipAgentReview { get; set; }
        @AuraEnabled public String reason { get; set; }
        @AuraEnabled public String fcosUrl { get; set; }

        public Readiness(VariableChargeInvoiceReadinessService.Readiness canonical) {
            this.ready = canonical?.ready == true;
            this.requiresShipAgentReview = canonical?.requiresVariableChargeReview == true;
            this.reason = canonical?.reason;
            this.fcosUrl = canonical?.fcosUrl;
        }
    }

    @AuraEnabled(cacheable=false)
    public static Readiness getReadiness(String stemId) {
        return new Readiness(VariableChargeInvoiceReadinessService.getBuyerReadiness(stemId));
    }

    public static Readiness evaluate(Id stemId) {
        if (stemId == null) return getReadiness(null);
        return new Readiness(VariableChargeInvoiceReadinessService.evaluateBuyer(stemId));
    }

    public static void assertFinalBuyerInvoiceAllowed(Id stemId) {
        VariableChargeInvoiceReadinessService.assertFinalBuyerInvoiceAllowed(stemId);
    }

    public static void assertPersistedInvoicesAllowed(Set<Id> invoiceIds) {
        VariableChargeInvoiceReadinessService.assertPersistedInvoicesAllowed(invoiceIds);
    }

    public static void assertInvoiceRecordsAllowed(List<Invoice__c> invoices) {
        VariableChargeInvoiceReadinessService.assertInvoiceRecordsAllowed(invoices);
    }

    public static void assertInvoiceTransitionsAllowed(Map<Id, Invoice__c> newMap, Map<Id, Invoice__c> oldMap) {
        VariableChargeInvoiceReadinessService.assertInvoiceTransitionsAllowed(newMap, oldMap);
    }

    public static Boolean isFinalBuyerInvoice(Invoice__c invoice) {
        return invoice != null && invoice.Proforma__c != true
            && !(String.isNotBlank(invoice.Name) && invoice.Name.toUpperCase().contains('-CN-'));
    }

    public static void invalidateForStemChanges(List<STEM__c> newRecords, Map<Id, STEM__c> oldMap) {
        VariableChargeInvoiceReadinessService.invalidateForStemChanges(newRecords, oldMap);
    }

    public static void invalidateForLineItemChanges(List<STEM_Line_Item__c> newRecords, Map<Id, STEM_Line_Item__c> oldMap) {
        VariableChargeInvoiceReadinessService.invalidateForLineItemChanges(newRecords, oldMap);
    }

    public static void invalidateForExtraCostChanges(List<STEM_Extra_Cost__c> newRecords, Map<Id, STEM_Extra_Cost__c> oldMap) {
        VariableChargeInvoiceReadinessService.invalidateForExtraCostChanges(newRecords, oldMap);
    }

    public static void invalidateForAccountChanges(Map<Id, Account> newMap, Map<Id, Account> oldMap) {
        VariableChargeInvoiceReadinessService.invalidateForAccountChanges(newMap, oldMap);
    }

    public static void invalidateForNominationChanges(List<Nomination__c> newRecords, Map<Id, Nomination__c> oldMap) {
        VariableChargeInvoiceReadinessService.invalidateForNominationChanges(newRecords, oldMap);
    }
}
