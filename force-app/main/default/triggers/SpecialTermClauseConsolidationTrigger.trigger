trigger SpecialTermClauseConsolidationTrigger on Special_Term_Clause_Consolidation__c (before insert, before update, before delete) {
    if (Trigger.isDelete) SpecialTermConsolidationHandler.preventConsolidationDelete(Trigger.old);
    else SpecialTermConsolidationHandler.validateConsolidations(Trigger.new, Trigger.isUpdate ? Trigger.oldMap : null);
}
