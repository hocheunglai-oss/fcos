trigger SpecialTermTrigger on Special_Term__c (before insert, before update, before delete) {
    if (Trigger.isBefore && Trigger.isDelete) {
        SpecialTermTriggerHandler.validateDelete(Trigger.old);
    } else if (Trigger.isBefore) {
        SpecialTermTriggerHandler.updateSpecialRemarks(Trigger.new);
        SpecialTermTriggerHandler.validateStructuredTerms(Trigger.new, Trigger.isUpdate ? Trigger.oldMap : null);
    }
}
