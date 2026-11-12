trigger InvoiceTrigger on Invoice__c (before insert, before update, after update, before delete) {
    if (Trigger.isBefore) {
        Map<Id,SObject> previousDocuments=new Map<Id,SObject>();
        if(Trigger.isUpdate || Trigger.isDelete) for(SObject previousDocument:Trigger.old) previousDocuments.put(previousDocument.Id,previousDocument);
        FcosTradeDocumentService.guardDocuments(Trigger.isDelete?Trigger.old:Trigger.new,previousDocuments,Trigger.isDelete);
    }

    if(!ContextManager.avoidInvoiceFiring){
        if(Trigger.isBefore && (Trigger.isInsert || Trigger.isUpdate)){
            if (Trigger.isInsert) {
                MasterContractInvoiceReadinessService.assertInvoiceRecordsAllowed(Trigger.new);
            } else {
                MasterContractInvoiceReadinessService.assertInvoiceTransitionsAllowed(Trigger.newMap, Trigger.oldMap);
            }
            if (Trigger.isInsert) {
                VariableChargeInvoiceReadinessService.assertInvoiceRecordsAllowed(Trigger.new);
            } else {
                VariableChargeInvoiceReadinessService.assertInvoiceTransitionsAllowed(Trigger.newMap, Trigger.oldMap);
            }
        }
        if(Trigger.isUpdate && Trigger.isAfter){
            InvoiceTriggerHandler.updateLineItemsAndExtraCosts(Trigger.newMap);
        }
        if(Trigger.isDelete && Trigger.isBefore){
            InvoiceTriggerHandler.updateMyobInvoices(Trigger.oldMap);
            InvoiceTriggerHandler.deleteContentDocuments(Trigger.oldMap);
            InvoiceTriggerHandler.updateLineItemsAndExtraCosts(Trigger.oldMap);

        }
    }
}
