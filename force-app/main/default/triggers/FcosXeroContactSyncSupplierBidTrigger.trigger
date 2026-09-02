trigger FcosXeroContactSyncSupplierBidTrigger on Supplier_Bid__c (after insert, after update) {
    FcosXeroContactSyncService.enqueueForSupplierBids(Trigger.new, Trigger.isUpdate ? Trigger.oldMap : null);
}
