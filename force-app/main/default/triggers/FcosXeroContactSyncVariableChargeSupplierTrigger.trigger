trigger FcosXeroContactSyncVariableChargeSupplierTrigger on STEM_Variable_Charge_Supplier__c (after insert, after update) {
    FcosXeroContactSyncService.enqueueForVariableChargeSuppliers(Trigger.new, Trigger.isUpdate ? Trigger.oldMap : null);
}
