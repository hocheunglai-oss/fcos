trigger SpecialTermClauseTrigger on Special_Term_Clause__c (before update, before delete) {
    if (Trigger.isUpdate) SpecialTermClauseHandler.beforeUpdate(Trigger.new, Trigger.oldMap);
    if (Trigger.isDelete) SpecialTermClauseHandler.beforeDelete(Trigger.old);
}
