public class PaidAmountService {
    public static void recalculateInvoiceAmount(List<Id> invoiceIds){
        String stemChargeRecordTypeId = Schema.SObjectType.STEM_Extra_Cost__c.getRecordTypeInfosByName().get('STEM Charge').getRecordTypeId();
        Id receivableRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Receivable').getRecordTypeId();
        Id bankChargeRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Bank Charge').getRecordTypeId();
        Id writeOffRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Write Off').getRecordTypeId();
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id, STEM__c, STEM__r.Total__c, Total_Price__c, Buyer_Invoice__c
                                                 FROM STEM_Line_Item__c WHERE Buyer_Invoice__c IN: invoiceIds AND Cancelled__c = false];
        List<STEM_Extra_Cost__c> stemExtraCosts = [SELECT Id, STEM__c, STEM__r.Total__c, Line_Total__c, Buyer_Invoice__c
                                                   FROM STEM_Extra_Cost__c WHERE Buyer_Invoice__c IN: invoiceIds AND Cancelled__c = false];
        Map<Id, Invoice__c> invoiceMap = new Map<Id, Invoice__c>([SELECT Id, Amount__c, Exported__c, Is_CSV_Info_Changed__c FROM Invoice__c WHERE Id IN: invoiceIds]);
        for(Invoice__c invoice: invoiceMap.values()){
            Decimal oldInvoiceAmount = invoice.Amount__c;
            invoice.Amount__c = 0;
            for(STEM_Line_Item__c stemLineItem: stemLineItems){
                if(stemLineItem.Buyer_Invoice__c == invoice.Id){
                    invoice.Amount__c += stemLineItem.Total_Price__c;
                }
            }
            for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
                if(stemExtraCost.Buyer_Invoice__c == invoice.Id){
                    invoice.Amount__c += stemExtraCost.Line_Total__c;
                }
            }
            if(invoice.Exported__c && invoice.Amount__c != oldInvoiceAmount){
                invoice.Is_CSV_Info_Changed__c = true;
            }
        }

        ContextManager.avoidInvoiceFiring = true;
        update invoiceMap.values();
        ContextManager.avoidInvoiceFiring = false;
    }

    public static void updatePaidAmount(Set<Id> invoiceIds) {
        List<Commission_Invoice__c> invoicesToUpdate = new List<Commission_Invoice__c>();

        Map<Id, Decimal> invoicePaymentSums = new Map<Id, Decimal>();

        for (AggregateResult aggregateResult : [
                SELECT Commission_Invoice__c, SUM(Amount__c) totalPaid
                FROM Payment__c
                WHERE Commission_Invoice__c IN :invoiceIds
                GROUP BY Commission_Invoice__c
        ]) {
            invoicePaymentSums.put((Id) aggregateResult.get('Commission_Invoice__c'), (Decimal) aggregateResult.get('totalPaid'));
        }

        for (Commission_Invoice__c invoice : [
                SELECT Id, Paid_Amount__c
                FROM Commission_Invoice__c
                WHERE Id IN :invoiceIds
        ]) {
            Decimal paidAmount = invoicePaymentSums.containsKey(invoice.Id) ? invoicePaymentSums.get(invoice.Id) : 0;
            invoice.Paid_Amount__c = paidAmount;
            invoicesToUpdate.add(invoice);
        }

        if (!invoicesToUpdate.isEmpty()) {
            update invoicesToUpdate;
        }
    }
}
