trigger SpecialTermRuleRevisionTrigger on Special_Term_Rule__c (before insert, before update, before delete) {
    SpecialTermRuleRevisionHandler.protect(Trigger.isDelete ? Trigger.old : Trigger.new);
}
