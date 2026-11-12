trigger NominationTrigger on Nomination__c (before insert, after insert, before update, after update, before delete, after delete) {
    if (Trigger.isBefore) {
        Map<Id,SObject> previousDocuments=new Map<Id,SObject>();
        if(Trigger.isUpdate || Trigger.isDelete) for(SObject previousDocument:Trigger.old) previousDocuments.put(previousDocument.Id,previousDocument);
        FcosTradeDocumentService.guardDocuments(Trigger.isDelete?Trigger.old:Trigger.new,previousDocuments,Trigger.isDelete);
    }

    if (ContextManager.skipTriggers) return;
    if(!ContextManager.avoidNominationFiring){
        if(Trigger.isInsert && Trigger.isAfter){
            NominationTriggerHandler.createStemStatuses(Trigger.new);
            VariableChargeInvoiceReadinessService.invalidateForNominationChanges(Trigger.new, null);
        }
        if(Trigger.isUpdate && Trigger.isBefore){
            NominationTriggerHandler.deprecateNomination(Trigger.new);
        }
        if(Trigger.isUpdate && Trigger.isAfter){
            VariableChargeInvoiceReadinessService.invalidateForNominationChanges(Trigger.new, Trigger.oldMap);
            //NominationTriggerHandler.assignSupplierNomination(Trigger.new);
        }
        if(Trigger.isDelete && Trigger.isBefore){
            NominationTriggerHandler.deleteContentDocuments(Trigger.oldMap);
        }
        if(Trigger.isDelete && Trigger.isAfter){
            VariableChargeInvoiceReadinessService.invalidateForNominationChanges(null, Trigger.oldMap);
        }
    }
}