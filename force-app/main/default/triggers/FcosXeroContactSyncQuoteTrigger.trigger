trigger FcosXeroContactSyncQuoteTrigger on Quote (after insert, after update) {
    FcosXeroContactSyncService.enqueueForQuotes(Trigger.new, Trigger.isUpdate ? Trigger.oldMap : null);
}
