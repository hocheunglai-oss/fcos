trigger NominationTrigger on Nomination__c (after insert, before update, after update, before delete, after delete) {
    if (ContextManager.skipTriggers) return;
    if(!ContextManager.avoidNominationFiring){
        if(Trigger.isInsert && Trigger.isAfter){
            NominationTriggerHandler.createStemStatuses(Trigger.new);
            ShipAgentInvoiceReadinessService.invalidateForNominationChanges(Trigger.new, null);
        }
        if(Trigger.isUpdate && Trigger.isBefore){
            NominationTriggerHandler.deprecateNomination(Trigger.new);
        }
        if(Trigger.isUpdate && Trigger.isAfter){
            ShipAgentInvoiceReadinessService.invalidateForNominationChanges(Trigger.new, Trigger.oldMap);
            //NominationTriggerHandler.assignSupplierNomination(Trigger.new);
        }
        if(Trigger.isDelete && Trigger.isBefore){
            NominationTriggerHandler.deleteContentDocuments(Trigger.oldMap);
        }
        if(Trigger.isDelete && Trigger.isAfter){
            ShipAgentInvoiceReadinessService.invalidateForNominationChanges(null, Trigger.oldMap);
        }
    }
}
