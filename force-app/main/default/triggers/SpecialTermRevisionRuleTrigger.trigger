trigger SpecialTermRevisionRuleTrigger on Special_Term_Revision_Rule__c (before insert, before update) {
    SpecialTermRevisionRuleHandler.validate(Trigger.new);
}
