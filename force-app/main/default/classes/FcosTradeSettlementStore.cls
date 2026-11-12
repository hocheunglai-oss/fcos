/** Exact visible invoices authorize complete payment evidence, independent of payment ownership. */
public without sharing class FcosTradeSettlementStore {
    public static List<Payment__c> payments(Set<Id> invoiceIds,Boolean supplier) {
        FcosTradeDocumentLineService.assertDocumentReadAccess(invoiceIds);
        for(Id invoiceId:invoiceIds) if(invoiceId.getSObjectType()!=(supplier?Supplier_Invoice__c.SObjectType:Invoice__c.SObjectType))
            throw new AuraHandledException('Settlement evidence must belong to one invoice side.');
        String parent=supplier?'Supplier_Invoice__c':'Buyer_Invoice__c';
        return Database.query('SELECT Id,STEM__c,Account__c,Buyer_Invoice__c,Supplier_Invoice__c,Amount__c,Payment_Currency__c,Payment_HKD_Amount__c,Invoice_Carrying_USD__c,Cash_Event__c,RecordType.DeveloperName FROM Payment__c WHERE '+parent+' IN :invoiceIds ORDER BY Id');
    }
}
