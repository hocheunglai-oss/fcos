trigger FcosXeroContactSyncStemTrigger on STEM__c (after insert, after update) {
    FcosXeroContactSyncService.enqueueForStems(Trigger.new, Trigger.isUpdate ? Trigger.oldMap : null);
}
