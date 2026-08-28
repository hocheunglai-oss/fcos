trigger VesselTrigger on Vessel__c (before insert, before update, after update) {
    if (ContextManager.skipTriggers) return;
    if (Trigger.isBefore) {
        VesselTriggerHandler.checkIMO(Trigger.new);
        VesselTriggerHandler.checkNrt(Trigger.new);
        VesselTriggerHandler.capitalizeName(Trigger.new);
    }
    if (Trigger.isAfter && Trigger.isUpdate) VariableChargeInvoiceReadinessService.invalidateForVesselChanges(Trigger.newMap, Trigger.oldMap);
}
