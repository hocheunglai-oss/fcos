trigger SpecialTermClauseTrigger on Special_Term_Clause__c (before delete) {
    SpecialTermClauseHandler.beforeDelete(Trigger.old);
}
