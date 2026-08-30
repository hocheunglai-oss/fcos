trigger FcosXeroContactSyncStemBuyerBrokerTrigger on STEM_Buyer_Broker__c (after insert, after update) {
    FcosXeroContactSyncService.enqueueForStemBuyerBrokers(Trigger.new, Trigger.isUpdate ? Trigger.oldMap : null);
}
