trigger SpecialTermClauseAssignmentTrigger on Special_Term_Clause_Assignment__c (before insert, before update, before delete, after insert, after update, after delete) {
    if (Trigger.isBefore && (Trigger.isInsert || Trigger.isUpdate)) SpecialTermAssignmentHandler.validate(Trigger.new, Trigger.isUpdate ? Trigger.oldMap : null);
    if (Trigger.isBefore && Trigger.isDelete) SpecialTermAssignmentHandler.beforeDelete(Trigger.old);
    if (Trigger.isAfter) {
        Set<Id> termIds = new Set<Id>();
        for (Special_Term_Clause_Assignment__c row : Trigger.isDelete ? Trigger.old : Trigger.new) if (row.Special_Term__c != null) termIds.add(row.Special_Term__c);
        if (Trigger.isUpdate) for (Special_Term_Clause_Assignment__c row : Trigger.old) if (row.Special_Term__c != null) termIds.add(row.Special_Term__c);
        SpecialTermAssignmentHandler.recompile(termIds);
    }
}
