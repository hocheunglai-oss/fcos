trigger SpecialTermClauseConsolidationMapTrigger on Special_Term_Clause_Consolidation_Map__c (before insert, before update, before delete) {
    if (Trigger.isDelete) SpecialTermConsolidationHandler.preventMappingDelete(Trigger.old);
    else SpecialTermConsolidationHandler.validateMappings(Trigger.new, Trigger.isUpdate ? Trigger.oldMap : null);
}
