trigger FcosXeroContactSyncStemLineItemTrigger on STEM_Line_Item__c (after insert, after update) {
    FcosXeroContactSyncService.enqueueForStemLineItems(Trigger.new, Trigger.isUpdate ? Trigger.oldMap : null);
}
