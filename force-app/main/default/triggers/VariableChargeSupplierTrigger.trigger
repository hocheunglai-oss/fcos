trigger VariableChargeSupplierTrigger on STEM_Variable_Charge_Supplier__c (before insert, before update) {
    VariableChargeSupplierHandler.guardEvidence(Trigger.new,Trigger.isUpdate?Trigger.oldMap:null);
    if (ContextManager.skipTriggers) return;
    if (Trigger.isInsert) VariableChargeSupplierHandler.beforeInsert(Trigger.new);
    if (Trigger.isUpdate) VariableChargeSupplierHandler.beforeUpdate(Trigger.new, Trigger.oldMap);
}
