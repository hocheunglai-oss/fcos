trigger SpecialTermClauseVersionTrigger on Special_Term_Clause_Version__c (before insert, before update, after update, before delete) {
    if (Trigger.isBefore && Trigger.isInsert) SpecialTermVersionHandler.beforeInsert(Trigger.new);
    if (Trigger.isBefore && Trigger.isUpdate) SpecialTermVersionHandler.beforeUpdate(Trigger.new, Trigger.oldMap);
    if (Trigger.isAfter && Trigger.isUpdate) SpecialTermVersionHandler.afterUpdate(Trigger.new, Trigger.oldMap);
    if (Trigger.isBefore && Trigger.isDelete) SpecialTermVersionHandler.beforeDelete(Trigger.old);
}
