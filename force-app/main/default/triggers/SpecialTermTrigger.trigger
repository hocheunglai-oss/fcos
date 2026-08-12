trigger SpecialTermTrigger on Special_Term__c (before insert, before update) {
    if (Trigger.isBefore) {
        SpecialTermTriggerHandler.updateSpecialRemarks(Trigger.new);
        SpecialTermTriggerHandler.validateStructuredTerms(Trigger.new, Trigger.isUpdate ? Trigger.oldMap : null);
    }
}