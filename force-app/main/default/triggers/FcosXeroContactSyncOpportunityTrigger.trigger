trigger FcosXeroContactSyncOpportunityTrigger on Opportunity (after insert, after update) {
    FcosXeroContactSyncService.enqueueForOpportunities(Trigger.new, Trigger.isUpdate ? Trigger.oldMap : null);
}
