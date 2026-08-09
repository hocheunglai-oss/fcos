trigger SpecialTermClauseVersionTrigger on Special_Term_Clause_Version__c (before insert, before update, before delete) {
    if (Trigger.isInsert) SpecialTermVersionHandler.beforeInsert(Trigger.new);
    if (Trigger.isUpdate) SpecialTermVersionHandler.beforeUpdate(Trigger.new, Trigger.oldMap);
    if (Trigger.isDelete) SpecialTermVersionHandler.beforeDelete(Trigger.old);
}
