public class InvoiceTriggerHandler {  
	public static void deleteContentDocuments(Map<Id, Invoice__c> invoiceMap) {
		List<ContentDocumentLink> contentDocumentLinkList = [SELECT Id, ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId In: invoiceMap.keySet()];
        List<String> docIdList = new List<String>();
        for(ContentDocumentLink cdl: ContentDocumentLinkList){
            docIdList.add(cdl.ContentDocumentId);
        }
        List<ContentDocument> conDocList = [SELECT Id FROM ContentDocument WHERE Id IN: docIdList];    
        delete conDocList;
    }
    
    public static void updateLineItemsAndExtraCosts(Map<Id, Invoice__c> invoiceMap){
       	Set<Id> stemIds = new Set<Id>();
        
        for(Invoice__c invoice: invoiceMap.values()){
        	stemIds.add(invoice.STEM__c);
        }
        Map<String, Boolean> deprecatedInvoices = new Map<String, Boolean>();
        for(Invoice__c invoice: [SELECT Id, File__c, Deprecated__c FROM Invoice__c WHERE STEM__c IN: stemIds]){
			deprecatedInvoices.put(invoice.File__c, invoice.Deprecated__c);
        }
        Map<Id, STEM_Line_Item__c> stemLineItemMap = new Map<Id, STEM_Line_Item__c>([SELECT Id, Input__c, Issued__c, Buyer_Invoice__c FROM STEM_Line_Item__c WHERE STEM__c IN: stemIds]);
        Map<Id, STEM_Extra_Cost__c> stemExtraCostMap = new Map<Id, STEM_Extra_Cost__c>([SELECT Id, Input__c, Issued__c, Buyer_Invoice__c FROM STEM_Extra_Cost__c WHERE STEM__c IN: stemIds]); 
        List<ContentDocumentLink> conDocLinks = [SELECT Id, LinkedEntityId, ContentDocumentId, ContentDocument.Title FROM ContentDocumentLink
                                                 WHERE (LinkedEntityId IN: stemLineItemMap.keySet() OR LinkedEntityId IN: stemExtraCostMap.keySet())
                                                 AND (ContentDocument.Title LIKE '%INV%' OR ContentDocument.Title LIKE '%CN%')];
        Map<Id, List<String>> linkedEntityIdToContentDocumentId = new Map<Id, List<String>>();
        for (ContentDocumentLink cdl : conDocLinks) {
            if (!linkedEntityIdToContentDocumentId.containsKey(cdl.LinkedEntityId)) {
                linkedEntityIdToContentDocumentId.put(cdl.LinkedEntityId, new List<String>());
            }
            linkedEntityIdToContentDocumentId.get(cdl.LinkedEntityId).add(cdl.ContentDocumentId);
        }
        List<Stem_Line_Item__c> stemLineItemsToUpdate = new List<STEM_Line_Item__c>();
        for (STEM_Line_Item__c lineItem : stemLineItemMap.values()) {
        	List<String> contentDocumentIds = linkedEntityIdToContentDocumentId.get(lineItem.Id);
            if (contentDocumentIds == null) {
            	lineItem.Input__c = '🔴';
                lineItem.Issued__c = false;
                lineItem.Buyer_Invoice__c = null;
                stemLineItemsToUpdate.add(lineItem);
            } else {
                Boolean allDeprecated = true;
                for (String docId : contentDocumentIds) {
                    String urlLink = Url.getOrgDomainURL().toExternalForm() + '/' + docId;
                    if (!deprecatedInvoices.containsKey(urlLink) || !deprecatedInvoices.get(urlLink)) {
                        allDeprecated = false;
                        break;
                    }
                }
                if (allDeprecated) {
                    lineItem.Input__c = '🔴';
                    lineItem.Issued__c = false;
                    lineItem.Buyer_Invoice__c = null;
                    stemLineItemsToUpdate.add(lineItem);
                }
        	}     
        }
       
        List<Stem_Extra_Cost__c> stemExtraCostsToUpdate = new List<Stem_Extra_Cost__c>();
        for (STEM_Extra_Cost__c extraCost : stemExtraCostMap.values()) {
        	List<String> contentDocumentIds = linkedEntityIdToContentDocumentId.get(extraCost.Id);
            if (contentDocumentIds == null) {
                extraCost.Input__c = '🔴';
                extraCost.Issued__c = false;
                extraCost.Buyer_Invoice__c = null;
                stemExtraCostsToUpdate.add(extraCost);
            } else {
                Boolean allDeprecated = true;
                for (String docId : contentDocumentIds) {
                    String urlLink = Url.getOrgDomainURL().toExternalForm() + '/' + docId;
                    if (!deprecatedInvoices.containsKey(urlLink) || !deprecatedInvoices.get(urlLink)) {
                        allDeprecated = false;
                        break;
                    }
                }
                if (allDeprecated) {
                    extraCost.Input__c = '🔴';
                    extraCost.Issued__c = false;
                    extraCost.Buyer_Invoice__c = null;
                    stemExtraCostsToUpdate.add(extraCost);
                }
        	}
        }
		ContextManager.avoidSTEMLineItemFiring = true;
        update stemLineItemsToUpdate;
        ContextManager.avoidSTEMLineItemFiring = false;
        ContextManager.avoidSTEMExtraCostFiring = true;
        update stemExtraCostsToUpdate;
        ContextManager.avoidSTEMExtraCostFiring = false;
        PaidAmountService.recalculateInvoiceAmount(new List<Id>(invoiceMap.keySet()));     
	}
    
    public static void updateMyobInvoices(Map<Id, Invoice__c> oldInvoiceMap){
        Set<Id> stemIds = new Set<Id>();
        List<String> refcodes = new List<String>();
        for(Invoice__c invoice: [SELECT Id, STEM__c, Invoice_Date__c, Amount__c, Exported__c, Refcode_Index__c
                                 FROM Invoice__c WHERE Id =: oldInvoiceMap.keySet()]){
            stemIds.add(invoice.STEM__c);
            if(invoice.Exported__c){               
                if(invoice.Invoice_Date__c != null){
                    refcodes.add(invoice.Refcode_Index__c);
                }        	    
            }    
        }
        
        refcodes.addAll(updatePurchasePart(oldInvoiceMap.keySet()));
        refcodes.addAll(updatePurchaseCommPart(oldInvoiceMap.keySet(), stemIds));
        MyobDataExportController.updateMyobInvoices(refcodes);
    }
    
    private static List<String> updatePurchasePart(Set<Id> invoiceIds){
        List<String> refcodes = new List<String>();
        String purchaseCsvRows = '';
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id, Is_Purchase_CSV_Exported__c, Is_Supplier_Purchase_Comm_Exported__c, Is_Buyer_Purchase_Comm_Exported__c,
                                                 Supplier_Invoice__c, Original_Supplier__c, STEM__c, Refcode_Index__c,  Buyer_Invoice__r.Invoice_Date__c, Total_Cost__c,
                                                 Is_Purchase_CSV_Info_Changed__c, Is_Supplier_Purchase_Comm_Info_Changed__c, Is_Buyer_Purchase_Comm_Info_Changed__c,
                                                 Supplier_Broker_Refcode_Index__c, Buyer_Broker_Refcode_Index__c
                                                 FROM STEM_Line_Item__c WHERE Buyer_Invoice__c IN: invoiceIds];
        List<STEM_Extra_Cost__c> stemExtraCosts = [SELECT Id, Is_Purchase_CSV_Exported__c, Supplier_Invoice__c, Supplier__c, STEM__c, Is_Purchase_CSV_Info_Changed__c,
                                                   Refcode_Index__c
                                                   FROM STEM_Extra_Cost__c WHERE Buyer_Invoice__c IN: invoiceIds];
        List<String> supplierInvoiceIds = new List<String>();
        for(STEM_Line_Item__c stemLineItem: stemLineItems){
            refcodes.add(stemLineItem.Refcode_Index__c);
            refcodes.add(stemLineItem.Supplier_Broker_Refcode_Index__c);
            refcodes.add(stemLineItem.Buyer_Broker_Refcode_Index__c); 
            supplierInvoiceIds.add(stemLineItem.Supplier_Invoice__c);
            stemLineItem.Is_Purchase_CSV_Exported__c = false;
            stemLineItem.Is_Purchase_CSV_Info_Changed__c = false;
            stemLineItem.Is_Supplier_Purchase_Comm_Exported__c = false;
            stemLineItem.Is_Supplier_Purchase_Comm_Info_Changed__c = false;
            stemLineItem.Is_Buyer_Purchase_Comm_Exported__c = false;
            stemLineItem.Is_Buyer_Purchase_Comm_Info_Changed__c = false;
            
        }
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
            refcodes.add(stemExtraCost.Refcode_Index__c);
            supplierInvoiceIds.add(stemExtraCost.Supplier_Invoice__c);
            stemExtraCost.Is_Purchase_CSV_Exported__c = false;
            stemExtraCost.Is_Purchase_CSV_Info_Changed__c = false;
        }
        ContextManager.avoidSTEMLineItemFiring = true;
        update stemLineItems;
        ContextManager.avoidSTEMLineItemFiring = false;
        ContextManager.avoidSTEMExtraCostFiring = true;
        update stemExtraCosts;
        ContextManager.avoidSTEMExtraCostFiring = false;
        
        List<Supplier_Invoice__c> supplierInvoices = [SELECT Id, Exported__c, Refcode_Index__c
                                                     FROM Supplier_Invoice__c WHERE Id IN: supplierInvoiceIds];
        for(Supplier_Invoice__c supplierInvoice: supplierInvoices){
            if(supplierInvoice.Exported__c){
                supplierInvoice.Exported__c = false;
                refcodes.add(supplierInvoice.Refcode_Index__c);
            }
                           
        }
        ContextManager.avoidSupplierInvoiceFiring = true;
        update supplierInvoices;
        ContextManager.avoidSupplierInvoiceFiring = false;
        return refcodes;
    }
    
    private static List<String> updatePurchaseCommPart(Set<Id> invoiceIds, Set<Id> stemIds){
        List<String> refcodes = new List<String>();
        List<Commission_Invoice__c> commissionInvoices = [SELECT Id, Exported__c, Is_CSV_Info_Changed__c, Refcode_Index__c
                                                 		  FROM Commission_Invoice__c WHERE STEM__c IN: stemIds];
        for(Commission_Invoice__c commissionInvoice: commissionInvoices){
            if(commissionInvoice.Exported__c){
                commissionInvoice.Exported__c = false;     
                commissionInvoice.Is_CSV_Info_Changed__c = false;  
                refcodes.add(commissionInvoice.Refcode_Index__c);            
            }    
        }
        update commissionInvoices;
        return refcodes;
    }
}