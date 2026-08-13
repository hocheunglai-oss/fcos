trigger SpecialTermRevisionClauseTrigger on Special_Term_Revision_Clause__c (before insert, before update) {
    SpecialTermRevisionClauseHandler.validate(Trigger.new, Trigger.isUpdate ? Trigger.oldMap : null);
}
