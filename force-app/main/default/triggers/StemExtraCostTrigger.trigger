trigger StemExtraCostTrigger on STEM_Extra_Cost__c(before insert ,before update, after insert, after update, before delete, after delete) {
    if (ContextManager.skipTriggers) return;
    if(!ContextManager.avoidSTEMExtraCostFiring){
        if((Trigger.IsInsert || Trigger.IsUpdate) && Trigger.IsBefore){
            if(Trigger.IsInsert){
                StemExtraCostTriggerHandler.setPortAndVessel(Trigger.new);
            }
            StemExtraCostTriggerHandler.passQuantityBDN(Trigger.new);
            StemExtraCostTriggerHandler.countLineTotalSell(Trigger.new);
            StemExtraCostTriggerHandler.countLineTotalBuy(Trigger.new);
        }

        if(Trigger.isUpdate && Trigger.IsBefore){
            StemExtraCostTriggerHandler.updateInput(Trigger.new, Trigger.oldMap);
            StemExtraCostTriggerHandler.updateIsChangedCSVField(Trigger.new, Trigger.oldMap);
        }

        if((Trigger.IsInsert || Trigger.IsUpdate) && Trigger.IsAfter){
            ShipAgentInvoiceReadinessService.invalidateForExtraCostChanges(Trigger.new, Trigger.isUpdate ? Trigger.oldMap : null);
            if(Trigger.IsInsert){
                StemExtraCostTriggerHandler.createNomination(Trigger.newMap);
            }
            if(Trigger.isUpdate){
                StemExtraCostTriggerHandler.updateNominationForSTEMCharge(Trigger.newMap, Trigger.oldMap);
                StemExtraCostTriggerHandler.updateConfirmations(Trigger.newMap, Trigger.oldMap);
                StemExtraCostTriggerHandler.updateNominationUnspecifiedSupplier(Trigger.newMap, Trigger.oldMap);
                StemExtraCostTriggerHandler.recalculateAmounts(Trigger.new, Trigger.oldMap);
                StemExtraCostTriggerHandler.updateDisputes(Trigger.new, Trigger.oldMap);
            }
            StemExtraCostTriggerHandler.applyEnquirySpecialTerms(Trigger.new);
            StemExtraCostTriggerHandler.setCalculatedAmountForSupplierInvoice(Trigger.new);
            StemExtraCostTriggerHandler.setTotalSellBuyAt(Trigger.newMap);
            StemExtraCostTriggerHandler.createCashflows(Trigger.newMap, Trigger.oldMap);
            StemExtraCostTriggerHandler.createDepositPayment(Trigger.new, Trigger.oldMap, Trigger.operationType);
            if(Trigger.isUpdate){
                StemExtraCostTriggerHandler.deleteDepositPayments(Trigger.new, Trigger.oldMap);
                StemExtraCostTriggerHandler.updateRelatedRecordsIsChangedCSvField(Trigger.new, Trigger.oldMap);
            }
            StemExtraCostTriggerHandler.updateUninvoicedPayments(Trigger.new, Trigger.oldMap, Trigger.operationType);
            StemExtraCostTriggerHandler.createReconfirmTasks(Trigger.new, Trigger.oldMap, Trigger.operationType);
        }
        if(Trigger.isBefore && Trigger.isDelete){
            StemExtraCostTriggerHandler.deprecateNomination(Trigger.oldMap);
        }
        if(Trigger.isAfter && Trigger.isDelete){
            ShipAgentInvoiceReadinessService.invalidateForExtraCostChanges(null, Trigger.oldMap);
            StemExtraCostTriggerHandler.deleteDepositPayments(Trigger.old);
            StemExtraCostTriggerHandler.deleteCashflows(Trigger.oldMap);
            StemExtraCostTriggerHandler.setTotalSellBuyAt(Trigger.oldMap);
            StemExtraCostTriggerHandler.updateUninvoicedPayments(Trigger.new, Trigger.oldMap, Trigger.operationType);
        }
    }
}
