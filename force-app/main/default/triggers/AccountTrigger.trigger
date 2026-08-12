trigger AccountTrigger on Account (before insert, before update, after insert, after update) {
    if (ContextManager.skipTriggers) return;
    if(!ContextManager.avoidAccountRecursion){
        if(Trigger.isBefore && (Trigger.isInsert || Trigger.isUpdate)){
            AccountTriggerHandler.setIsBrokerCheckbox(Trigger.new);
            AccountTriggerHandler.validateEmails(Trigger.new);
            if(Trigger.isUpdate){
                AccountTriggerHandler.copyCompaniesFields(Trigger.new, Trigger.oldMap);
            }
        }
        if(Trigger.isAfter && (Trigger.isInsert || Trigger.isUpdate)){
            //AccountTriggerHandler.setSharedCheckbox(Trigger.new);
            if(Trigger.isUpdate){
                ShipAgentInvoiceReadinessService.invalidateForAccountChanges(Trigger.newMap, Trigger.oldMap);
                AccountTriggerHandler.populateMailingRequirement(Trigger.newMap, Trigger.oldMap);
            }
            AccountTriggerHandler.setDefaultContact(Trigger.new, Trigger.oldMap);
        }
    }
}