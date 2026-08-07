trigger StemTrigger on STEM__c(before insert, before update, after insert, after update, before delete, after delete) {
    if (ContextManager.skipTriggers) return;
    if(Trigger.isInsert && Trigger.isAfter){
        StemTriggerHandler.createCashflow(Trigger.new);
        StemTriggerHandler.createPaymentOverview(Trigger.new);
        StemTriggerHandler.createMailingRecord(Trigger.new);
    }
    if((Trigger.isUpdate || Trigger.isInsert) && Trigger.IsBefore){
        StemTriggerHandler.setExpectedDeliveryDate(Trigger.new);
        StemTriggerHandler.passBuyersPayTermDate(Trigger.new);
        StemTriggerHandler.setPaymentDelayForHistoricalStem(Trigger.new);
    }
    if(Trigger.isUpdate && Trigger.IsBefore){
        StemTriggerHandler.setPaymentDelayForOriginatedStem(Trigger.new);
        StemTriggerHandler.setInvoiceStatus(Trigger.new);
        StemTriggerHandler.resetPsprs(Trigger.new, Trigger.oldMap);
        StemTriggerHandler.removeBuyerBrokerRefcodeIndex(Trigger.new, Trigger.oldMap);
    }
    if(Trigger.isUpdate && Trigger.IsAfter){
        ShipAgentInvoiceReadinessService.invalidateForStemChanges(Trigger.new, Trigger.oldMap);
        StemTriggerHandler.deleteDisputes(Trigger.new);
        StemTriggerHandler.updateNominations(Trigger.newMap, Trigger.oldMap);
        StemTriggerHandler.updateConfirmationWhenBuyerIsChanged(Trigger.newMap, Trigger.oldMap);
        StemTriggerHandler.updateCashflows(Trigger.newMap, Trigger.oldMap);
        StemTriggerHandler.sendCompeletedNotification(Trigger.new, Trigger.oldMap);
        StemTriggerHandler.updateLastPayments(Trigger.new, Trigger.oldMap);
        StemTriggerHandler.updateIsChangedCSVField(Trigger.new, Trigger.oldMap);
        StemTriggerHandler.updateVesselAndPort(Trigger.new, Trigger.oldMap);
        StemTriggerHandler.updateDisputes(Trigger.new, Trigger.oldMap);
    }
    if(Trigger.isDelete && Trigger.isBefore){
        StemTriggerHandler.deleteInvoices(Trigger.oldMap);
        StemTriggerHandler.deleteStemPaymentOverviews(Trigger.oldMap);
        StemTriggerHandler.deleteCashflows(Trigger.oldMap);
        StemTriggerHandler.deleteDisputes(Trigger.oldMap);
        StemTriggerHandler.deleteMailingRecords(Trigger.oldMap);
        StemTriggerHandler.deleteStemStatuses(Trigger.oldMap);
        StemTriggerHandler.deleteContentDocuments(Trigger.oldMap);
        StemTriggerHandler.deleteCommissionInvoices(Trigger.oldMap);
    }
}
