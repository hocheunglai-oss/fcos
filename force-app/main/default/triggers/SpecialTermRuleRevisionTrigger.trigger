trigger SpecialTermRuleRevisionTrigger on Special_Term_Rule__c (before insert, before update, before delete) {
    if (Trigger.isDelete) SpecialTermRuleRevisionHandler.beforeDelete(Trigger.old);
    else SpecialTermRuleRevisionHandler.protect(Trigger.new);
}
