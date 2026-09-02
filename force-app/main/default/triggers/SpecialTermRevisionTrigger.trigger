trigger SpecialTermRevisionTrigger on Special_Term_Revision__c (before insert, before update, before delete) {
    if (Trigger.isBefore && Trigger.isInsert) SpecialTermRevisionHandler.beforeInsert(Trigger.new);
    if (Trigger.isBefore && Trigger.isUpdate) SpecialTermRevisionHandler.beforeUpdate(Trigger.new, Trigger.oldMap);
    if (Trigger.isBefore && Trigger.isDelete) SpecialTermRevisionHandler.beforeDelete(Trigger.old);
}
