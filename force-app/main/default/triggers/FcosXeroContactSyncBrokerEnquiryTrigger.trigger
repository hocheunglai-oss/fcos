trigger FcosXeroContactSyncBrokerEnquiryTrigger on Broker_Enquiry__c (after insert, after update) {
    FcosXeroContactSyncService.enqueueForBrokerEnquiries(Trigger.new, Trigger.isUpdate ? Trigger.oldMap : null);
}
