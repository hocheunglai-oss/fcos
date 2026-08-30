trigger FcosXeroContactSyncStemExtraCostTrigger on STEM_Extra_Cost__c (after insert, after update) {
    FcosXeroContactSyncService.enqueueForStemExtraCosts(Trigger.new, Trigger.isUpdate ? Trigger.oldMap : null);
}
